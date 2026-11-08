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

/** A sign-in challenge waiting for its signature. */
export interface AuthChallenge {
  /** Random, single-use. */
  nonce: string;
  address: string;
  /** The exact text the wallet signs. */
  message: string;
  /** Seconds since the epoch (server clock). */
  expiresAt: number;
}

/** A sign-in session. Only the sha256 of the session id is stored. */
export interface Session {
  idHash: string;
  address: string;
  createdAt: number;
  expiresAt: number;
}

/** Draft visibility: `draft` is visible to its author only, `published` to everyone. */
export type DraftStatus = 'draft' | 'published';

/** A proposal text being written and discussed off-chain. */
export interface StoredDraft {
  /** Random public id. */
  id: string;
  author: string;
  title: string;
  /** Markdown, exactly as written. */
  body: string;
  /** sha256 of the exact UTF-8 body, hex: the value to use as the proposal's `description_hash`. */
  contentHash: string;
  status: DraftStatus;
  createdAt: number;
  updatedAt: number;
  /** The on-chain proposal whose `description_hash` equals `contentHash`, once one exists. */
  proposalId: number | null;
}

/** Filters for {@link Store.listDrafts}. Results are newest first. */
export interface DraftQuery {
  author?: string | undefined;
  status?: DraftStatus | undefined;
  /** Pagination cursor from a previous page. */
  before?: string | undefined;
  limit: number;
}

/** What a comment is attached to. */
export type CommentTarget = { type: 'draft'; id: string } | { type: 'proposal'; id: number };

/** One comment in a flat list. */
export interface StoredComment {
  id: number;
  target: CommentTarget;
  author: string;
  body: string;
  createdAt: number;
  /** Set when the author edited it. */
  editedAt: number | null;
}

/** Persistence used by the indexer and the API. */
export interface Store {
  /** Stores a new draft. */
  createDraft(d: StoredDraft): Promise<void>;
  /** Replaces a draft's title, body, hash, status, update time and link. */
  updateDraft(d: StoredDraft): Promise<void>;
  /** A draft by id. */
  getDraft(id: string): Promise<StoredDraft | undefined>;
  /** Drafts, newest first, with the cursor for the next page (`undefined` at the end). */
  listDrafts(q: DraftQuery): Promise<{ drafts: StoredDraft[]; next: string | undefined }>;
  /** Links every unlinked published draft whose hash is `hash`; returns how many. */
  linkDrafts(hash: string, proposalId: number): Promise<number>;
  /** Published drafts linked to a proposal, oldest first. */
  draftsForProposal(proposalId: number): Promise<StoredDraft[]>;
  /** The lowest proposal id with this description hash, if any. */
  proposalIdByHash(hash: string): Promise<number | undefined>;

  /** Stores a comment and returns its id. */
  addComment(c: Omit<StoredComment, 'id'>): Promise<number>;
  /** A comment by id. */
  getComment(id: number): Promise<StoredComment | undefined>;
  /** Changes a comment's body. */
  editComment(id: number, body: string, editedAt: number): Promise<void>;
  /** Removes a comment. */
  deleteComment(id: number): Promise<void>;
  /** Comments on a target, oldest first, after `afterId` if given. */
  listComments(
    target: CommentTarget,
    q: { afterId?: number | undefined; limit: number },
  ): Promise<StoredComment[]>;

  /** Stores a new challenge and deletes expired ones. */
  saveChallenge(c: AuthChallenge, now: number): Promise<void>;
  /**
   * Marks a challenge used and returns it as it was, or `undefined` if the nonce is unknown.
   * `alreadyUsed` is true when an earlier call consumed it (a replay).
   */
  consumeChallenge(nonce: string): Promise<(AuthChallenge & { alreadyUsed: boolean }) | undefined>;
  /** Stores a session. */
  createSession(s: Session): Promise<void>;
  /** A session by the hash of its id. */
  getSession(idHash: string): Promise<Session | undefined>;
  /** Deletes a session (sign-out). */
  deleteSession(idHash: string): Promise<void>;
  /** Deletes expired sessions; returns how many. */
  purgeSessions(now: number): Promise<number>;

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
