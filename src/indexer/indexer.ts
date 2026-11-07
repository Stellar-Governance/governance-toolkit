import type { ChainClient, EventQuery } from '../chain/client.js';
import { RpcResponseError } from '../errors.js';
import type { ChainProposal, GovEvent, ProposalStateName } from '../chain/types.js';
import type {
  Store,
  StoredAccount,
  StoredAction,
  StoredProposal,
  StoredVote,
} from '../store/types.js';

/** Options for {@link Indexer}. */
export interface IndexerOptions {
  chain: ChainClient;
  store: Store;
  /** First ledger to read events from when nothing is stored yet (for example the deploy ledger). */
  startLedger?: number | undefined;
  /** Events per `getEvents` page (1..10000). */
  pageSize?: number;
  /** Most pages per run, so one run cannot take forever after a long pause. */
  maxPages?: number;
  /** Local clock in seconds, only used to time-stamp recorded gaps. */
  now?: () => number;
  /** Called when a gap is recorded or a run fails; defaults to no output. */
  log?: (message: string) => void;
}

/** What one run did. */
export interface IndexRunResult {
  newProposals: number;
  refreshedProposals: number;
  events: number;
  /** A gap recorded in this run, if any. */
  gap: { fromLedger: number; toLedger: number } | undefined;
  /** True when more event pages are waiting (the run hit `maxPages`). */
  moreEvents: boolean;
}

/** Converts a chain proposal to its stored, JSON-safe form. */
export function toStoredProposal(
  id: number,
  p: ChainProposal,
  state: ProposalStateName,
  checkedAt: number,
): StoredProposal {
  const actions: StoredAction[] = p.actions.map((a) =>
    a.kind === 'UpdateConfig'
      ? {
          kind: 'UpdateConfig',
          config: { ...a.config, proposalThreshold: a.config.proposalThreshold.toString() },
        }
      : { kind: 'Invoke', contract: a.contract, function: a.function, args: a.args },
  );
  return {
    id,
    proposer: p.proposer,
    title: p.title,
    descriptionHash: p.descriptionHash,
    uri: p.uri,
    actions,
    snapshotLedger: p.snapshotLedger,
    voteStart: p.voteStart,
    voteEnd: p.voteEnd,
    totalPower: p.totalPower.toString(),
    quorum: p.quorum.toString(),
    timelockSecs: p.timelockSecs,
    gracePeriodSecs: p.gracePeriodSecs,
    forVotes: p.forVotes.toString(),
    againstVotes: p.againstVotes.toString(),
    abstainVotes: p.abstainVotes.toString(),
    eta: p.eta,
    executed: p.executed,
    canceled: p.canceled,
    state,
    checkedAt,
  };
}

function toRows(events: GovEvent[]): { votes: StoredVote[]; deposits: StoredAccount[] } {
  const votes: StoredVote[] = [];
  const deposits: StoredAccount[] = [];
  for (const e of events) {
    if (e.kind === 'vote_cast') {
      votes.push({
        proposalId: Number(e.proposalId),
        voter: e.voter,
        choice: e.choice,
        power: e.power.toString(),
        ledger: e.ledger,
        closedAt: e.closedAt,
        txHash: e.txHash,
        eventId: e.id,
      });
    } else if (e.kind === 'deposited' || e.kind === 'withdrawn') {
      deposits.push({
        address: e.account,
        deposit: e.deposit.toString(),
        ledger: e.ledger,
        eventId: e.id,
      });
    }
  }
  return { votes, deposits };
}

/**
 * Keeps the store in line with the chain.
 *
 * - Proposals come from `proposal_count` + `get_proposal`; contract state is not limited by RPC
 *   retention, so the proposal list and its tallies are always complete. Proposals whose state
 *   can still change are re-read on every run.
 * - Per-voter votes and per-account deposits come from events, read with a stored cursor. RPC keeps
 *   events for a limited window (about 7 days on testnet). When the stored position is older than
 *   the oldest ledger the RPC still has, the missing range is recorded as a gap instead of being
 *   skipped silently.
 */
export class Indexer {
  private readonly pageSize: number;
  private readonly maxPages: number;
  private readonly now: () => number;
  private readonly log: (message: string) => void;

  /** @param options - chain, store and paging settings */
  constructor(private readonly options: IndexerOptions) {
    this.pageSize = options.pageSize ?? 200;
    this.maxPages = options.maxPages ?? 50;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.log = options.log ?? (() => undefined);
  }

  /**
   * Runs one indexing pass: new proposals, refreshed open proposals, then new events.
   * @returns counts of what changed
   * @throws whatever the chain client throws (timeouts, RPC errors); the store stays consistent
   *   because each event page is committed with its cursor in one transaction
   */
  async runOnce(): Promise<IndexRunResult> {
    const { chain, store } = this.options;
    const latest = await chain.latestLedger();

    // Proposals: new ids, then everything not final yet.
    const count = Number(await chain.proposalCount());
    const known = await store.maxProposalId();
    let newProposals = 0;
    for (let id = known + 1; id <= count; id++) {
      await this.refreshProposal(id, latest.closeTime);
      newProposals++;
    }
    const open = (await store.openProposalIds()).filter((id) => id <= known);
    for (const id of open) await this.refreshProposal(id, latest.closeTime);

    // Events.
    const retention = await chain.retention();
    const stored = await store.getCursor();
    let gap: IndexRunResult['gap'];
    let query: EventQuery;
    let nextLedger: number;
    if (stored === undefined) {
      const start = this.options.startLedger ?? retention.oldestLedger;
      nextLedger = start;
      if (start < retention.oldestLedger) {
        gap = { fromLedger: start, toLedger: retention.oldestLedger - 1 };
        nextLedger = retention.oldestLedger;
      }
      query = { startLedger: nextLedger };
    } else if (stored.nextLedger < retention.oldestLedger) {
      // WAVE-ISSUE(toolkit-5): backfill from history archives (or an archival RPC's queryEvents)
      // would fill this range instead of recording it as a gap.
      gap = { fromLedger: stored.nextLedger, toLedger: retention.oldestLedger - 1 };
      nextLedger = retention.oldestLedger;
      query = { startLedger: nextLedger };
    } else {
      nextLedger = stored.nextLedger;
      query = stored.cursor === null ? { startLedger: nextLedger } : { cursor: stored.cursor };
    }
    if (gap !== undefined) {
      await store.recordGap({ ...gap, recordedAt: this.now() });
      this.log(
        `events in ledgers ${String(gap.fromLedger)}-${String(gap.toLedger)} are no longer available from RPC; recorded as a gap`,
      );
    }

    let events = 0;
    let moreEvents = false;
    for (let page = 0; ; page++) {
      if (page >= this.maxPages) {
        moreEvents = true;
        break;
      }
      let result;
      try {
        result = await chain.events(query, this.pageSize);
      } catch (e) {
        // A cursor the RPC no longer accepts: start again from the stored ledger. Replaying
        // events is harmless (see Store.commitEvents).
        if (!('cursor' in query) || !(e instanceof RpcResponseError)) throw e;
        this.log(
          `RPC rejected the stored cursor (${e.message}); continuing from ledger ${String(nextLedger)}`,
        );
        query = { startLedger: nextLedger };
        result = await chain.events(query, this.pageSize);
      }
      const rows = toRows(result.events);
      const last = result.events.at(-1);
      // A short page means everything up to the RPC's latest ledger has been seen.
      const full = result.events.length >= this.pageSize;
      const reached = full ? (last?.ledger ?? nextLedger) : result.latestLedger + 1;
      nextLedger = Math.max(nextLedger, reached);
      await store.commitEvents({ ...rows, cursor: { cursor: result.cursor, nextLedger } });
      events += result.events.length;
      if (!full) break;
      query = { cursor: result.cursor };
    }
    return {
      newProposals,
      refreshedProposals: open.length,
      events,
      gap,
      moreEvents,
    };
  }

  private async refreshProposal(id: number, checkedAt: number): Promise<void> {
    const { chain, store } = this.options;
    const p = await chain.proposal(BigInt(id));
    const state = await chain.proposalState(BigInt(id));
    await store.upsertProposal(toStoredProposal(id, p, state, checkedAt));
  }
}
