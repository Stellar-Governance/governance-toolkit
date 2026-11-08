import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { PROPOSAL_STATES, VOTE_CHOICES, type ProposalStateName } from '../chain/types.js';
import type {
  AuthChallenge,
  CommentTarget,
  DraftQuery,
  EventBatch,
  IndexCursor,
  IndexGap,
  ProposalQuery,
  Session,
  Store,
  StoredAccount,
  StoredAction,
  StoredComment,
  StoredDraft,
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
  // 2: sign-in
  `CREATE TABLE auth_challenges (
     nonce TEXT PRIMARY KEY,
     address TEXT NOT NULL,
     message TEXT NOT NULL,
     expires_at INTEGER NOT NULL,
     used INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE sessions (
     id_hash TEXT PRIMARY KEY,
     address TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   );
   CREATE INDEX sessions_expiry ON sessions(expires_at);`,
  // 3: drafts and comments
  `CREATE TABLE drafts (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     id TEXT NOT NULL UNIQUE,
     author TEXT NOT NULL,
     title TEXT NOT NULL,
     body TEXT NOT NULL,
     content_hash TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     proposal_id INTEGER
   );
   CREATE INDEX drafts_author ON drafts(author);
   CREATE INDEX drafts_hash ON drafts(content_hash);
   CREATE INDEX drafts_proposal ON drafts(proposal_id);
   CREATE TABLE comments (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     target_type TEXT NOT NULL CHECK (target_type IN ('draft', 'proposal')),
     target_id TEXT NOT NULL,
     author TEXT NOT NULL,
     body TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     edited_at INTEGER
   );
   CREATE INDEX comments_target ON comments(target_type, target_id, id);`,
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

function draftParams(d: StoredDraft): Record<string, string | number | null> {
  return {
    id: d.id,
    author: d.author,
    title: d.title,
    body: d.body,
    hash: d.contentHash,
    status: d.status,
    created: d.createdAt,
    updated: d.updatedAt,
    proposal: d.proposalId,
  };
}

function toDraft(row: Row): StoredDraft {
  const status = str(row, 'status');
  if (status !== 'draft' && status !== 'published') throw new TypeError(`bad status ${status}`);
  return {
    id: str(row, 'id'),
    author: str(row, 'author'),
    title: str(row, 'title'),
    body: str(row, 'body'),
    contentHash: str(row, 'content_hash'),
    status,
    createdAt: int(row, 'created_at'),
    updatedAt: int(row, 'updated_at'),
    proposalId: row.proposal_id === null ? null : int(row, 'proposal_id'),
  };
}

function toComment(row: Row): StoredComment {
  const type = str(row, 'target_type');
  const targetId = str(row, 'target_id');
  let target: CommentTarget;
  if (type === 'draft') target = { type: 'draft', id: targetId };
  else if (type === 'proposal') target = { type: 'proposal', id: Number(targetId) };
  else throw new TypeError(`bad comment target ${type}`);
  return {
    id: int(row, 'id'),
    target,
    author: str(row, 'author'),
    body: str(row, 'body'),
    createdAt: int(row, 'created_at'),
    editedAt: row.edited_at === null ? null : int(row, 'edited_at'),
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
  createDraft(d: StoredDraft): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO drafts (id, author, title, body, content_hash, status, created_at,
           updated_at, proposal_id)
         VALUES (:id, :author, :title, :body, :hash, :status, :created, :updated, :proposal)`,
      )
      .run(draftParams(d));
    return Promise.resolve();
  }

  /** @inheritdoc */
  updateDraft(d: StoredDraft): Promise<void> {
    this.db
      .prepare(
        `UPDATE drafts SET title = :title, body = :body, content_hash = :hash, status = :status,
           updated_at = :updated, proposal_id = :proposal
         WHERE id = :id`,
      )
      .run({
        id: d.id,
        title: d.title,
        body: d.body,
        hash: d.contentHash,
        status: d.status,
        updated: d.updatedAt,
        proposal: d.proposalId,
      });
    return Promise.resolve();
  }

  /** @inheritdoc */
  getDraft(id: string): Promise<StoredDraft | undefined> {
    const row = this.db.prepare('SELECT * FROM drafts WHERE id = ?').get(id);
    return Promise.resolve(row === undefined ? undefined : toDraft(row));
  }

  /** @inheritdoc */
  listDrafts(q: DraftQuery): Promise<{ drafts: StoredDraft[]; next: string | undefined }> {
    const before = q.before === undefined ? null : Number(q.before);
    const rows = this.db
      .prepare(
        `SELECT * FROM drafts
         WHERE (:author IS NULL OR author = :author)
           AND (:status IS NULL OR status = :status)
           AND (:before IS NULL OR seq < :before)
         ORDER BY seq DESC LIMIT :limit`,
      )
      .all({
        author: q.author ?? null,
        status: q.status ?? null,
        before: before !== null && Number.isSafeInteger(before) ? before : null,
        limit: q.limit,
      });
    const last = rows.at(-1);
    return Promise.resolve({
      drafts: rows.map(toDraft),
      next: rows.length === q.limit && last !== undefined ? String(int(last, 'seq')) : undefined,
    });
  }

  /** @inheritdoc */
  linkDrafts(hash: string, proposalId: number): Promise<number> {
    const r = this.db
      .prepare(
        `UPDATE drafts SET proposal_id = ?
         WHERE content_hash = ? AND status = 'published' AND proposal_id IS NULL`,
      )
      .run(proposalId, hash);
    return Promise.resolve(Number(r.changes));
  }

  /** @inheritdoc */
  draftsForProposal(proposalId: number): Promise<StoredDraft[]> {
    const rows = this.db
      .prepare(`SELECT * FROM drafts WHERE proposal_id = ? AND status = 'published' ORDER BY seq`)
      .all(proposalId);
    return Promise.resolve(rows.map(toDraft));
  }

  /** @inheritdoc */
  proposalIdByHash(hash: string): Promise<number | undefined> {
    const row = this.db
      .prepare('SELECT MIN(id) AS id FROM proposals WHERE description_hash = ?')
      .get(hash);
    return Promise.resolve(row === undefined || row.id === null ? undefined : int(row, 'id'));
  }

  /** @inheritdoc */
  addComment(c: Omit<StoredComment, 'id'>): Promise<number> {
    const r = this.db
      .prepare(
        `INSERT INTO comments (target_type, target_id, author, body, created_at, edited_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(c.target.type, String(c.target.id), c.author, c.body, c.createdAt, c.editedAt);
    return Promise.resolve(Number(r.lastInsertRowid));
  }

  /** @inheritdoc */
  getComment(id: number): Promise<StoredComment | undefined> {
    const row = this.db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
    return Promise.resolve(row === undefined ? undefined : toComment(row));
  }

  /** @inheritdoc */
  editComment(id: number, body: string, editedAt: number): Promise<void> {
    this.db
      .prepare('UPDATE comments SET body = ?, edited_at = ? WHERE id = ?')
      .run(body, editedAt, id);
    return Promise.resolve();
  }

  /** @inheritdoc */
  deleteComment(id: number): Promise<void> {
    this.db.prepare('DELETE FROM comments WHERE id = ?').run(id);
    return Promise.resolve();
  }

  /** @inheritdoc */
  listComments(
    target: CommentTarget,
    q: { afterId?: number | undefined; limit: number },
  ): Promise<StoredComment[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM comments
         WHERE target_type = :type AND target_id = :id AND (:after IS NULL OR id > :after)
         ORDER BY id LIMIT :limit`,
      )
      .all({ type: target.type, id: String(target.id), after: q.afterId ?? null, limit: q.limit });
    return Promise.resolve(rows.map(toComment));
  }

  /** @inheritdoc */
  saveChallenge(c: AuthChallenge, now: number): Promise<void> {
    this.inTransaction(() => {
      this.db.prepare('DELETE FROM auth_challenges WHERE expires_at <= ?').run(now);
      this.db
        .prepare(
          'INSERT INTO auth_challenges (nonce, address, message, expires_at) VALUES (?, ?, ?, ?)',
        )
        .run(c.nonce, c.address, c.message, c.expiresAt);
    });
    return Promise.resolve();
  }

  /** @inheritdoc */
  consumeChallenge(nonce: string): Promise<(AuthChallenge & { alreadyUsed: boolean }) | undefined> {
    const result = this.inTransaction(() => {
      const row = this.db.prepare('SELECT * FROM auth_challenges WHERE nonce = ?').get(nonce);
      if (row === undefined) return undefined;
      this.db.prepare('UPDATE auth_challenges SET used = 1 WHERE nonce = ?').run(nonce);
      return {
        nonce: str(row, 'nonce'),
        address: str(row, 'address'),
        message: str(row, 'message'),
        expiresAt: int(row, 'expires_at'),
        alreadyUsed: int(row, 'used') === 1,
      };
    });
    return Promise.resolve(result);
  }

  /** @inheritdoc */
  createSession(s: Session): Promise<void> {
    this.db
      .prepare(
        'INSERT INTO sessions (id_hash, address, created_at, expires_at) VALUES (?, ?, ?, ?)',
      )
      .run(s.idHash, s.address, s.createdAt, s.expiresAt);
    return Promise.resolve();
  }

  /** @inheritdoc */
  getSession(idHash: string): Promise<Session | undefined> {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id_hash = ?').get(idHash);
    return Promise.resolve(
      row === undefined
        ? undefined
        : {
            idHash: str(row, 'id_hash'),
            address: str(row, 'address'),
            createdAt: int(row, 'created_at'),
            expiresAt: int(row, 'expires_at'),
          },
    );
  }

  /** @inheritdoc */
  deleteSession(idHash: string): Promise<void> {
    this.db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(idHash);
    return Promise.resolve();
  }

  /** @inheritdoc */
  purgeSessions(now: number): Promise<number> {
    const r = this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    return Promise.resolve(Number(r.changes));
  }

  /** @inheritdoc */
  close(): Promise<void> {
    this.db.close();
    return Promise.resolve();
  }
}
