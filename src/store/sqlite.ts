import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { PROPOSAL_STATES, VOTE_CHOICES, type ProposalStateName } from '../chain/types.js';
import type {
  EventBatch,
  IndexCursor,
  IndexGap,
  ProposalQuery,
  Store,
  StoredAccount,
  StoredAction,
  StoredProposal,
  StoredVote,
} from './types.js';

type Row = Record<string, SQLOutputValue>;

/** Schema migrations, applied in order; `PRAGMA user_version` records how many ran. */
export const MIGRATIONS: readonly string[] = [
  // 1: indexer tables
  `CREATE TABLE proposals (
     id INTEGER PRIMARY KEY,
     proposer TEXT NOT NULL,
     title TEXT NOT NULL,
     description_hash TEXT NOT NULL,
     uri TEXT NOT NULL,
     actions_json TEXT NOT NULL,
     snapshot_ledger INTEGER NOT NULL,
     vote_start INTEGER NOT NULL,
     vote_end INTEGER NOT NULL,
     total_power TEXT NOT NULL,
     quorum TEXT NOT NULL,
     timelock_secs INTEGER NOT NULL,
     grace_period_secs INTEGER NOT NULL,
     for_votes TEXT NOT NULL,
     against_votes TEXT NOT NULL,
     abstain_votes TEXT NOT NULL,
     eta INTEGER NOT NULL,
     executed INTEGER NOT NULL,
     canceled INTEGER NOT NULL,
     state TEXT NOT NULL,
     checked_at INTEGER NOT NULL
   );
   CREATE INDEX proposals_state ON proposals(state);
   CREATE INDEX proposals_proposer ON proposals(proposer);
   CREATE INDEX proposals_hash ON proposals(description_hash);
   CREATE TABLE votes (
     proposal_id INTEGER NOT NULL,
     voter TEXT NOT NULL,
     choice TEXT NOT NULL,
     power TEXT NOT NULL,
     ledger INTEGER NOT NULL,
     closed_at TEXT NOT NULL,
     tx_hash TEXT NOT NULL,
     event_id TEXT NOT NULL UNIQUE,
     PRIMARY KEY (proposal_id, voter)
   );
   CREATE INDEX votes_voter ON votes(voter);
   CREATE TABLE accounts (
     address TEXT PRIMARY KEY,
     deposit TEXT NOT NULL,
     ledger INTEGER NOT NULL,
     event_id TEXT NOT NULL
   );
   CREATE TABLE index_cursor (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     cursor TEXT,
     next_ledger INTEGER NOT NULL
   );
   CREATE TABLE index_gaps (
     from_ledger INTEGER NOT NULL,
     to_ledger INTEGER NOT NULL,
     recorded_at INTEGER NOT NULL
   );`,
];

function str(row: Row, col: string): string {
  const v = row[col];
  if (typeof v !== 'string') throw new TypeError(`column ${col} is not text`);
  return v;
}

function int(row: Row, col: string): number {
  const v = row[col];
  if (typeof v === 'bigint') return Number(v);
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
    throw new TypeError(`column ${col} is not an integer`);
  }
  return v;
}

function optStr(row: Row, col: string): string | null {
  const v = row[col];
  return v === null ? null : str(row, col);
}

function state(row: Row): ProposalStateName {
  const s = str(row, 'state');
  const found = PROPOSAL_STATES.find((x) => x === s);
  if (found === undefined) throw new TypeError(`unknown state ${s}`);
  return found;
}

function toProposal(row: Row): StoredProposal {
  return {
    id: int(row, 'id'),
    proposer: str(row, 'proposer'),
    title: str(row, 'title'),
    descriptionHash: str(row, 'description_hash'),
    uri: str(row, 'uri'),
    actions: JSON.parse(str(row, 'actions_json')) as StoredAction[],
    snapshotLedger: int(row, 'snapshot_ledger'),
    voteStart: int(row, 'vote_start'),
    voteEnd: int(row, 'vote_end'),
    totalPower: str(row, 'total_power'),
    quorum: str(row, 'quorum'),
    timelockSecs: int(row, 'timelock_secs'),
    gracePeriodSecs: int(row, 'grace_period_secs'),
    forVotes: str(row, 'for_votes'),
    againstVotes: str(row, 'against_votes'),
    abstainVotes: str(row, 'abstain_votes'),
    eta: int(row, 'eta'),
    executed: int(row, 'executed') === 1,
    canceled: int(row, 'canceled') === 1,
    state: state(row),
    checkedAt: int(row, 'checked_at'),
  };
}

function toVote(row: Row): StoredVote {
  const choice = str(row, 'choice');
  const found = VOTE_CHOICES.find((c) => c === choice);
  if (found === undefined) throw new TypeError(`unknown choice ${choice}`);
  return {
    proposalId: int(row, 'proposal_id'),
    voter: str(row, 'voter'),
    choice: found,
    power: str(row, 'power'),
    ledger: int(row, 'ledger'),
    closedAt: str(row, 'closed_at'),
    txHash: str(row, 'tx_hash'),
    eventId: str(row, 'event_id'),
  };
}

/**
 * {@link Store} on SQLite through Node's built-in `node:sqlite` (synchronous; wrapped in promises).
 * Use `:memory:` as the path for tests.
 */
export class SqliteStore implements Store {
  private readonly db: DatabaseSync;

  /** @param path - database file, or `:memory:` */
  constructor(path: string) {
    this.db = new DatabaseSync(path, { enableForeignKeyConstraints: true, timeout: 5_000 });
    this.db.exec('PRAGMA journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get();
    const version = row === undefined ? 0 : int(row, 'user_version');
    for (let v = version; v < MIGRATIONS.length; v++) {
      const sql = MIGRATIONS[v];
      if (sql === undefined) break;
      this.inTransaction(() => {
        this.db.exec(sql);
        this.db.exec(`PRAGMA user_version = ${String(v + 1)}`);
      });
    }
  }

  /** Runs `fn` in a transaction; rolls back if it throws. */
  protected inTransaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** The underlying database, for subclasses that add tables. */
  protected get database(): DatabaseSync {
    return this.db;
  }

  /** @inheritdoc */
  upsertProposal(p: StoredProposal): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO proposals (id, proposer, title, description_hash, uri, actions_json,
           snapshot_ledger, vote_start, vote_end, total_power, quorum, timelock_secs,
           grace_period_secs, for_votes, against_votes, abstain_votes, eta, executed, canceled,
           state, checked_at)
         VALUES (:id, :proposer, :title, :hash, :uri, :actions, :snapshot, :start, :end, :total,
           :quorum, :timelock, :grace, :for, :against, :abstain, :eta, :executed, :canceled,
           :state, :checked)
         ON CONFLICT(id) DO UPDATE SET
           for_votes = excluded.for_votes, against_votes = excluded.against_votes,
           abstain_votes = excluded.abstain_votes, eta = excluded.eta,
           executed = excluded.executed, canceled = excluded.canceled,
           state = excluded.state, checked_at = excluded.checked_at`,
      )
      .run({
        id: p.id,
        proposer: p.proposer,
        title: p.title,
        hash: p.descriptionHash,
        uri: p.uri,
        actions: JSON.stringify(p.actions),
        snapshot: p.snapshotLedger,
        start: p.voteStart,
        end: p.voteEnd,
        total: p.totalPower,
        quorum: p.quorum,
        timelock: p.timelockSecs,
        grace: p.gracePeriodSecs,
        for: p.forVotes,
        against: p.againstVotes,
        abstain: p.abstainVotes,
        eta: p.eta,
        executed: p.executed ? 1 : 0,
        canceled: p.canceled ? 1 : 0,
        state: p.state,
        checked: p.checkedAt,
      });
    return Promise.resolve();
  }

  /** @inheritdoc */
  getProposal(id: number): Promise<StoredProposal | undefined> {
    const row = this.db.prepare('SELECT * FROM proposals WHERE id = ?').get(id);
    return Promise.resolve(row === undefined ? undefined : toProposal(row));
  }

  /** @inheritdoc */
  listProposals(q: ProposalQuery): Promise<StoredProposal[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM proposals
         WHERE (:state IS NULL OR state = :state)
           AND (:proposer IS NULL OR proposer = :proposer)
           AND (:before IS NULL OR id < :before)
         ORDER BY id DESC LIMIT :limit`,
      )
      .all({
        state: q.state ?? null,
        proposer: q.proposer ?? null,
        before: q.beforeId ?? null,
        limit: q.limit,
      });
    return Promise.resolve(rows.map(toProposal));
  }

  /** @inheritdoc */
  maxProposalId(): Promise<number> {
    const row = this.db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM proposals').get();
    return Promise.resolve(row === undefined ? 0 : int(row, 'm'));
  }

  /** @inheritdoc */
  openProposalIds(): Promise<number[]> {
    const rows = this.db
      .prepare(
        `SELECT id FROM proposals
         WHERE state NOT IN ('Defeated', 'Executed', 'Canceled', 'Expired') ORDER BY id`,
      )
      .all();
    return Promise.resolve(rows.map((r) => int(r, 'id')));
  }

  /** @inheritdoc */
  commitEvents(batch: EventBatch): Promise<void> {
    const insertVote = this.db.prepare(
      `INSERT INTO votes (proposal_id, voter, choice, power, ledger, closed_at, tx_hash, event_id)
       VALUES (:proposal, :voter, :choice, :power, :ledger, :closed, :tx, :event)
       ON CONFLICT DO NOTHING`,
    );
    const upsertAccount = this.db.prepare(
      `INSERT INTO accounts (address, deposit, ledger, event_id)
       VALUES (:address, :deposit, :ledger, :event)
       ON CONFLICT(address) DO UPDATE SET
         deposit = excluded.deposit, ledger = excluded.ledger, event_id = excluded.event_id
       WHERE excluded.ledger > accounts.ledger
          OR (excluded.ledger = accounts.ledger AND excluded.event_id > accounts.event_id)`,
    );
    const setCursor = this.db.prepare(
      `INSERT INTO index_cursor (id, cursor, next_ledger) VALUES (1, :cursor, :next)
       ON CONFLICT(id) DO UPDATE SET cursor = excluded.cursor, next_ledger = excluded.next_ledger`,
    );
    this.inTransaction(() => {
      for (const v of batch.votes) {
        insertVote.run({
          proposal: v.proposalId,
          voter: v.voter,
          choice: v.choice,
          power: v.power,
          ledger: v.ledger,
          closed: v.closedAt,
          tx: v.txHash,
          event: v.eventId,
        });
      }
      for (const a of batch.deposits) {
        upsertAccount.run({
          address: a.address,
          deposit: a.deposit,
          ledger: a.ledger,
          event: a.eventId,
        });
      }
      setCursor.run({ cursor: batch.cursor.cursor, next: batch.cursor.nextLedger });
    });
    return Promise.resolve();
  }

  /** @inheritdoc */
  listVotes(
    proposalId: number,
    q: { afterEventId?: string | undefined; limit: number },
  ): Promise<StoredVote[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM votes WHERE proposal_id = :id AND (:after IS NULL OR event_id > :after)
         ORDER BY event_id LIMIT :limit`,
      )
      .all({ id: proposalId, after: q.afterEventId ?? null, limit: q.limit });
    return Promise.resolve(rows.map(toVote));
  }

  /** @inheritdoc */
  votesByVoter(voter: string): Promise<StoredVote[]> {
    const rows = this.db
      .prepare('SELECT * FROM votes WHERE voter = ? ORDER BY event_id')
      .all(voter);
    return Promise.resolve(rows.map(toVote));
  }

  /** @inheritdoc */
  getAccount(address: string): Promise<StoredAccount | undefined> {
    const row = this.db.prepare('SELECT * FROM accounts WHERE address = ?').get(address);
    return Promise.resolve(
      row === undefined
        ? undefined
        : {
            address: str(row, 'address'),
            deposit: str(row, 'deposit'),
            ledger: int(row, 'ledger'),
            eventId: str(row, 'event_id'),
          },
    );
  }

  /** @inheritdoc */
  getCursor(): Promise<IndexCursor | undefined> {
    const row = this.db.prepare('SELECT cursor, next_ledger FROM index_cursor WHERE id = 1').get();
    return Promise.resolve(
      row === undefined
        ? undefined
        : { cursor: optStr(row, 'cursor'), nextLedger: int(row, 'next_ledger') },
    );
  }

  /** @inheritdoc */
  recordGap(gap: IndexGap): Promise<void> {
    this.db
      .prepare('INSERT INTO index_gaps (from_ledger, to_ledger, recorded_at) VALUES (?, ?, ?)')
      .run(gap.fromLedger, gap.toLedger, gap.recordedAt);
    return Promise.resolve();
  }

  /** @inheritdoc */
  listGaps(): Promise<IndexGap[]> {
    const rows = this.db.prepare('SELECT * FROM index_gaps ORDER BY from_ledger').all();
    return Promise.resolve(
      rows.map((r) => ({
        fromLedger: int(r, 'from_ledger'),
        toLedger: int(r, 'to_ledger'),
        recordedAt: int(r, 'recorded_at'),
      })),
    );
  }

  /** @inheritdoc */
  close(): Promise<void> {
    this.db.close();
    return Promise.resolve();
  }
}
