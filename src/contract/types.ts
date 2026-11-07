// GENERATED FILE: do not edit by hand. Regenerate with the command in ./README.md.
// Source: governance contract CAOERDLG52UU6X5JENOXNKN4DWWJPVPNK7AD4RYXE3MA4TRBY62O5I5F (testnet),
// wasm sha256 b08f42668fb100075b215766c5b3a278d5888fbfab57cb2c8b358fc57b1b30ef,
// generated 2026-11-07 by @stellar/stellar-sdk 17.4.0 (stellar-js generate).
/* eslint-disable */

import {xdr, Address} from '@stellar/stellar-sdk';

    /**
 * Every way a contract call can fail.
 */
export const Error = {
  /**
   * A config value is outside its allowed bounds.
   */
  1 : { message: "InvalidConfig" },
  /**
   * The amount must be greater than zero.
   */
  2 : { message: "InvalidAmount" },
  /**
   * The withdrawal is larger than the account's deposit.
   */
  3 : { message: "InsufficientDeposit" },
  /**
   * The proposer's power at the snapshot is below the proposal threshold.
   */
  4 : { message: "BelowThreshold" },
  /**
   * A proposal may hold at most 5 actions, and an Invoke at most 8 arguments.
   */
  5 : { message: "TooManyActions" },
  /**
   * An Invoke action may not target the governance token or this contract.
   */
  6 : { message: "ForbiddenTarget" },
  /**
   * The title (max 120 bytes) or URI (max 200 bytes) is too long.
   */
  7 : { message: "TextTooLong" },
  /**
   * No proposal exists with this id.
   */
  8 : { message: "ProposalNotFound" },
  /**
   * Voting is not open for this proposal.
   */
  9 : { message: "VotingClosed" },
  /**
   * This address has already voted on this proposal.
   */
  10 : { message: "AlreadyVoted" },
  /**
   * This address had no voting power at the proposal's snapshot.
   */
  11 : { message: "NoVotingPower" },
  /**
   * The proposal is not in a state that allows this call.
   */
  12 : { message: "WrongState" },
  /**
   * The proposal is queued but its timelock has not passed yet.
   */
  13 : { message: "TimelockActive" },
  /**
   * The caller is not allowed to do this.
   */
  14 : { message: "NotAuthorized" },
  /**
   * A proposal action failed while executing; nothing was changed.
   */
  15 : { message: "ActionFailed" },
  /**
   * The token transfer failed (for example, insufficient token balance).
   */
  16 : { message: "TokenFailed" },
  /**
   * An arithmetic result was out of range.
   */
  17 : { message: "Overflow" },
  /**
   * The requested ledger is in the future.
   */
  18 : { message: "SnapshotNotPast" }
}

/**
 * A call the contract makes to another contract when a proposal executes.
 */
export interface Call {
  /**
   * Arguments, at most `MAX_ARGS`.
   */
  args: Array<any>;
  /**
   * Target contract. Never the governance token or this contract (`ForbiddenTarget`).
   */
  contract: string;
  /**
   * Function name on the target.
   */
  function: string;
}

/**
 * One step of a proposal.
 */
 export type Action =
  /**
   * Replace the governance settings. Affects only proposals created later.
   */
  { tag: "UpdateConfig"; values: readonly [Config] } |
  /**
   * Call another contract as the governance contract.
   */
  { tag: "Invoke"; values: readonly [Call] };

/**
 * Governance settings. Times are ledger timestamps in seconds.
 * Changed only by a passed proposal carrying [`Action::UpdateConfig`].
 */
export interface Config {
  /**
   * Seconds after the timelock during which `execute` is allowed; after that the proposal is Expired.
   */
  grace_period_secs: bigint;
  /**
   * Power at the snapshot ledger needed to create a proposal (0 allowed).
   */
  proposal_threshold: bigint;
  /**
   * Quorum in basis points (1..=10_000) of total power at the snapshot. For + Abstain must reach it.
   */
  quorum_bps: number;
  /**
   * Seconds between `queue` and the earliest `execute`.
   */
  timelock_secs: bigint;
  /**
   * Seconds from proposal creation until voting opens.
   */
  voting_delay_secs: bigint;
  /**
   * Length of the voting window in seconds.
   */
  voting_period_secs: bigint;
}

/**
 * A stored proposal.
 */
export interface Proposal {
  abstain_votes: bigint;
  actions: Array<Action>;
  against_votes: bigint;
  canceled: boolean;
  /**
   * sha256 of the full proposal text, kept off-chain.
   */
  description_hash: Uint8Array;
  /**
   * Earliest execution time; 0 until queued.
   */
  eta: bigint;
  executed: boolean;
  for_votes: bigint;
  /**
   * Grace period copied from the config at creation (decision D19).
   */
  grace_period_secs: bigint;
  proposer: string;
  /**
   * Votes (For + Abstain) needed, fixed at creation.
   */
  quorum: bigint;
  /**
   * Voting power is read from changes in ledgers strictly before this one.
   */
  snapshot_ledger: number;
  /**
   * Timelock copied from the config at creation (decision D19).
   */
  timelock_secs: bigint;
  title: string;
  /**
   * Total deposited power at the snapshot, fixed at creation.
   */
  total_power: bigint;
  /**
   * Where the full text can be read.
   */
  uri: string;
  vote_end: bigint;
  vote_start: bigint;
}

/**
 * A voter's choice. The numeric values are part of the interface.
 */
export enum VoteChoice {
  /**
   * Enum Case: Against
   */
  Against = 0,
  /**
   * Enum Case: For
   */
  For = 1,
  /**
   * Enum Case: Abstain
   */
  Abstain = 2
}

/**
 * How one address voted on one proposal.
 */
export interface VoteRecord {
  choice: VoteChoice;
  power: bigint;
}

/**
 * Lifecycle state of a proposal, derived from time and flags.
 */
export enum ProposalState {
  /**
   * Created; voting has not opened.
   */
  Pending = 0,
  /**
   * Voting is open.
   */
  Active = 1,
  /**
   * Voting ended without passing (quorum missed, tie, or more Against).
   */
  Defeated = 2,
  /**
   * Voting ended and the proposal passed; waiting for `queue`.
   */
  Succeeded = 3,
  /**
   * Queued; executable from `eta` until `eta + grace`.
   */
  Queued = 4,
  /**
   * Executed. Final.
   */
  Executed = 5,
  /**
   * Canceled by its proposer. Final.
   */
  Canceled = 6,
  /**
   * Queued but not executed within the grace period. Final.
   */
  Expired = 7
}

/**
 * A vote was cast.
 */
export interface VoteCastEvent {
  name: "VoteCast";
  data: {
    proposal_id: bigint;
    voter: string;
    choice?: VoteChoice;
    power?: bigint;
  };
}

/**
 * `from` deposited `amount`. `deposit` and `total` are the values after the change.
 */
export interface DepositedEvent {
  name: "Deposited";
  data: {
    account: string;
    amount?: bigint;
    deposit?: bigint;
    total?: bigint;
  };
}

/**
 * `account` withdrew `amount`. `deposit` and `total` are the values after the change.
 */
export interface WithdrawnEvent {
  name: "Withdrawn";
  data: {
    account: string;
    amount?: bigint;
    deposit?: bigint;
    total?: bigint;
  };
}

/**
 * The settings were replaced by an executed proposal.
 */
export interface ConfigUpdatedEvent {
  name: "ConfigUpdated";
  data: {
    proposal_id: bigint;
    config?: Config;
  };
}

/**
 * A proposal was queued; it can be executed from `eta`.
 */
export interface ProposalQueuedEvent {
  name: "ProposalQueued";
  data: {
    proposal_id: bigint;
    eta?: bigint;
  };
}

/**
 * A proposal was created.
 */
export interface ProposalCreatedEvent {
  name: "ProposalCreated";
  data: {
    proposal_id: bigint;
    proposer: string;
    snapshot_ledger?: number;
    vote_start?: bigint;
    vote_end?: bigint;
    description_hash?: Uint8Array;
    total_power?: bigint;
    quorum?: bigint;
  };
}

/**
 * A proposal was canceled by its proposer.
 */
export interface ProposalCanceledEvent {
  name: "ProposalCanceled";
  data: {
    proposal_id: bigint;
  };
}

/**
 * A proposal was executed.
 */
export interface ProposalExecutedEvent {
  name: "ProposalExecuted";
  data: {
    proposal_id: bigint;
  };
}
    export type ContractEvent = VoteCastEvent | DepositedEvent | WithdrawnEvent | ConfigUpdatedEvent | ProposalQueuedEvent | ProposalCreatedEvent | ProposalCanceledEvent | ProposalExecutedEvent;
    
