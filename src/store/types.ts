/**
 * Storage interface. Asynchronous on purpose, so a server database can implement it later.
 * Amounts (i128) are decimal strings; ledgers, ids and times (seconds) are numbers.
 * Only public data is stored: addresses, amounts, ledgers, times, hashes, states, and text that
 * authors chose to publish. No IP addresses, e-mails or names.
 */
import type { ProposalStateName, VoteChoiceName } from '../chain/types.js';

/** A proposal action in JSON-safe form. */
export type StoredAction =
  | {
      kind: 'UpdateConfig';
      config: {
        votingDelaySecs: number;
        votingPeriodSecs: number;
        timelockSecs: number;
        gracePeriodSecs: number;
        proposalThreshold: string;
        quorumBps: number;
      };
    }
  | { kind: 'Invoke'; contract: string; function: string; args: unknown[] };

/** A proposal as indexed from the chain. */
export interface StoredProposal {
  id: number;
  proposer: string;
  title: string;
  /** sha256 of the full text, hex. */
  descriptionHash: string;
  uri: string;
  actions: StoredAction[];
  snapshotLedger: number;
  voteStart: number;
  voteEnd: number;
  totalPower: string;
  quorum: string;
  timelockSecs: number;
  gracePeriodSecs: number;
  forVotes: string;
  againstVotes: string;
  abstainVotes: string;
  /** 0 until queued. */
  eta: number;
  executed: boolean;
  canceled: boolean;
  /** State at `checkedAt`. */
  state: ProposalStateName;
  /** Ledger close time (seconds) when the proposal was last read from the chain. */
  checkedAt: number;
}

/** One vote, from a `vote_cast` event. */
export interface StoredVote {
  proposalId: number;
  voter: string;
  choice: VoteChoiceName;
  power: string;
  ledger: number;
  /** ISO time the ledger closed. */
  closedAt: string;
  txHash: string;
  eventId: string;
}

/** An account's current deposit, from `deposited` / `withdrawn` events. */
export interface StoredAccount {
  address: string;
  deposit: string;
  ledger: number;
  /** The event the value comes from; later events win. */
  eventId: string;
}

/** Where event indexing stands. */
export interface IndexCursor {
  /** RPC cursor to continue from, or `null` to start from `nextLedger`. */
  cursor: string | null;
  /** Events in ledgers before this one have been processed (or recorded as a gap). */
  nextLedger: number;
}

/** A ledger range whose events could not be read because the RPC no longer has them. */
export interface IndexGap {
  fromLedger: number;
  toLedger: number;
  /** Seconds since the epoch, local clock, when the gap was found. */
  recordedAt: number;
}

/** Changes from one page of events, written together with the new cursor. */
export interface EventBatch {
  votes: StoredVote[];
  deposits: StoredAccount[];
  cursor: IndexCursor;
}

/** Filters for {@link Store.listProposals}. Results are newest first. */
export interface ProposalQuery {
  state?: ProposalStateName | undefined;
  proposer?: string | undefined;
  /** Only ids below this one (the pagination cursor). */
  beforeId?: number | undefined;
  limit: number;
}

/** Persistence used by the indexer and the API. */
export interface Store {
  /** Creates or replaces a proposal. */
  upsertProposal(p: StoredProposal): Promise<void>;
  /** A proposal by id. */
  getProposal(id: number): Promise<StoredProposal | undefined>;
  /** Proposals, newest first. */
  listProposals(q: ProposalQuery): Promise<StoredProposal[]>;
  /** Highest stored proposal id, 0 when there are none. */
  maxProposalId(): Promise<number>;
  /** Ids of stored proposals whose state can still change. */
  openProposalIds(): Promise<number[]>;

  /**
   * Writes a page of indexed events and the new cursor in one transaction. Replaying the same
   * events changes nothing: a vote is stored once per (proposal, voter), and a deposit only
   * replaces an older one.
   */
  commitEvents(batch: EventBatch): Promise<void>;
  /** Votes on a proposal, in event order, after `afterEventId` if given. */
  listVotes(
    proposalId: number,
    q: { afterEventId?: string | undefined; limit: number },
  ): Promise<StoredVote[]>;
  /** Every vote by `voter`, in event order. */
  votesByVoter(voter: string): Promise<StoredVote[]>;
  /** An account's current deposit as seen in events. */
  getAccount(address: string): Promise<StoredAccount | undefined>;

  /** Where event indexing stands, or `undefined` before the first run. */
  getCursor(): Promise<IndexCursor | undefined>;
  /** Records a range of ledgers whose events were lost to RPC retention. */
  recordGap(gap: IndexGap): Promise<void>;
  /** Every recorded gap, oldest first. */
  listGaps(): Promise<IndexGap[]>;

  /** Releases the database. */
  close(): Promise<void>;
}
