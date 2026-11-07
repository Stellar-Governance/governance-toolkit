import { StrKey } from '@stellar/stellar-sdk';
import { z } from 'zod';

/** Proposal states, numbered as in the contract. */
export const PROPOSAL_STATES = [
  'Pending',
  'Active',
  'Defeated',
  'Succeeded',
  'Queued',
  'Executed',
  'Canceled',
  'Expired',
] as const;
/** A proposal state name. */
export type ProposalStateName = (typeof PROPOSAL_STATES)[number];
/** States that never change again. */
export const FINAL_STATES: ReadonlySet<ProposalStateName> = new Set([
  'Defeated',
  'Executed',
  'Canceled',
  'Expired',
]);

/** Vote choices, numbered as in the contract. */
export const VOTE_CHOICES = ['Against', 'For', 'Abstain'] as const;
/** A vote choice name. */
export type VoteChoiceName = (typeof VOTE_CHOICES)[number];

const address = z
  .string()
  .refine((s) => StrKey.isValidEd25519PublicKey(s) || StrKey.isValidContract(s), {
    message: 'not a Stellar address',
  });
const u32 = z
  .number()
  .int()
  .min(0)
  .max(2 ** 32 - 1);
/** u64 values that must fit a JS number (timestamps, durations). */
const u64Safe = z
  .bigint()
  .min(0n)
  .max(BigInt(Number.MAX_SAFE_INTEGER))
  .transform((v) => Number(v));
const i128 = z.bigint();
const bytes32 = z
  .instanceof(Uint8Array)
  .refine((b) => b.length === 32, 'expected 32 bytes')
  .transform((b) => Buffer.from(b).toString('hex'));
const stateIndex = z
  .number()
  .int()
  .min(0)
  .max(PROPOSAL_STATES.length - 1)
  .transform((i) => PROPOSAL_STATES[i] ?? 'Pending');
const choiceIndex = z
  .number()
  .int()
  .min(0)
  .max(VOTE_CHOICES.length - 1)
  .transform((i) => VOTE_CHOICES[i] ?? 'Against');

/** Governance settings as decoded from the contract. */
export const configSchema = z
  .object({
    voting_delay_secs: u64Safe,
    voting_period_secs: u64Safe,
    timelock_secs: u64Safe,
    grace_period_secs: u64Safe,
    proposal_threshold: i128,
    quorum_bps: u32,
  })
  .transform((c) => ({
    votingDelaySecs: c.voting_delay_secs,
    votingPeriodSecs: c.voting_period_secs,
    timelockSecs: c.timelock_secs,
    gracePeriodSecs: c.grace_period_secs,
    proposalThreshold: c.proposal_threshold,
    quorumBps: c.quorum_bps,
  }));
/** Governance settings. */
export type GovConfig = z.output<typeof configSchema>;

/** Turns decoded `Invoke` arguments into JSON-safe values for storage and display. */
export function toJsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value instanceof Map) {
    return [...(value as Map<unknown, unknown>).entries()].map(([k, v]) => [
      toJsonSafe(k),
      toJsonSafe(v),
    ]);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJsonSafe(v)]));
  }
  return value;
}

const actionSchema = z.union([
  z
    .object({ tag: z.literal('UpdateConfig'), values: z.tuple([configSchema]) })
    .transform((a) => ({ kind: 'UpdateConfig' as const, config: a.values[0] })),
  z
    .object({
      tag: z.literal('Invoke'),
      values: z.tuple([
        z.object({ contract: address, function: z.string(), args: z.array(z.unknown()) }),
      ]),
    })
    .transform((a) => ({
      kind: 'Invoke' as const,
      contract: a.values[0].contract,
      function: a.values[0].function,
      args: a.values[0].args.map(toJsonSafe),
    })),
]);
/** One proposal action. */
export type ProposalAction = z.output<typeof actionSchema>;

/** A proposal as decoded from `get_proposal`. */
export const proposalSchema = z
  .object({
    proposer: address,
    title: z.string(),
    description_hash: bytes32,
    uri: z.string(),
    actions: z.array(actionSchema),
    snapshot_ledger: u32,
    vote_start: u64Safe,
    vote_end: u64Safe,
    total_power: i128,
    quorum: i128,
    timelock_secs: u64Safe,
    grace_period_secs: u64Safe,
    for_votes: i128,
    against_votes: i128,
    abstain_votes: i128,
    eta: u64Safe,
    executed: z.boolean(),
    canceled: z.boolean(),
  })
  .transform((p) => ({
    proposer: p.proposer,
    title: p.title,
    descriptionHash: p.description_hash,
    uri: p.uri,
    actions: p.actions,
    snapshotLedger: p.snapshot_ledger,
    voteStart: p.vote_start,
    voteEnd: p.vote_end,
    totalPower: p.total_power,
    quorum: p.quorum,
    timelockSecs: p.timelock_secs,
    gracePeriodSecs: p.grace_period_secs,
    forVotes: p.for_votes,
    againstVotes: p.against_votes,
    abstainVotes: p.abstain_votes,
    eta: p.eta,
    executed: p.executed,
    canceled: p.canceled,
  }));
/** A proposal read from the chain (without its id). */
export type ChainProposal = z.output<typeof proposalSchema>;

/** Decodes a `ProposalState` value. */
export const stateSchema = stateIndex;

/** A vote record as decoded from `get_vote`. */
export const voteRecordSchema = z
  .object({ choice: choiceIndex, power: i128 })
  .transform((v) => ({ choice: v.choice, power: v.power }));
/** How one address voted. */
export type ChainVote = z.output<typeof voteRecordSchema>;

/** Where an event came from. */
export interface EventMeta {
  /** RPC event id; unique and ordered. */
  id: string;
  ledger: number;
  /** ISO time the ledger closed. */
  closedAt: string;
  txHash: string;
}

const eventData = {
  Deposited: z
    .object({ account: address, amount: i128, deposit: i128, total: i128 })
    .transform((d) => ({ kind: 'deposited' as const, ...d })),
  Withdrawn: z
    .object({ account: address, amount: i128, deposit: i128, total: i128 })
    .transform((d) => ({ kind: 'withdrawn' as const, ...d })),
  ProposalCreated: z
    .object({
      proposal_id: z.bigint(),
      proposer: address,
      snapshot_ledger: u32,
      vote_start: u64Safe,
      vote_end: u64Safe,
      description_hash: bytes32,
      total_power: i128,
      quorum: i128,
    })
    .transform((d) => ({
      kind: 'proposal_created' as const,
      proposalId: d.proposal_id,
      proposer: d.proposer,
      snapshotLedger: d.snapshot_ledger,
      voteStart: d.vote_start,
      voteEnd: d.vote_end,
      descriptionHash: d.description_hash,
      totalPower: d.total_power,
      quorum: d.quorum,
    })),
  VoteCast: z
    .object({ proposal_id: z.bigint(), voter: address, choice: choiceIndex, power: i128 })
    .transform((d) => ({
      kind: 'vote_cast' as const,
      proposalId: d.proposal_id,
      voter: d.voter,
      choice: d.choice,
      power: d.power,
    })),
  ProposalCanceled: z
    .object({ proposal_id: z.bigint() })
    .transform((d) => ({ kind: 'proposal_canceled' as const, proposalId: d.proposal_id })),
  ProposalQueued: z.object({ proposal_id: z.bigint(), eta: u64Safe }).transform((d) => ({
    kind: 'proposal_queued' as const,
    proposalId: d.proposal_id,
    eta: d.eta,
  })),
  ProposalExecuted: z
    .object({ proposal_id: z.bigint() })
    .transform((d) => ({ kind: 'proposal_executed' as const, proposalId: d.proposal_id })),
  ConfigUpdated: z.object({ proposal_id: z.bigint(), config: configSchema }).transform((d) => ({
    kind: 'config_updated' as const,
    proposalId: d.proposal_id,
    config: d.config,
  })),
} as const;

/** Event payload schemas keyed by the contract's event name. */
export const EVENT_SCHEMAS: Readonly<Record<string, z.ZodType<GovEventBody>>> = eventData;

/** A decoded governance event body. */
export type GovEventBody = {
  [K in keyof typeof eventData]: z.output<(typeof eventData)[K]>;
}[keyof typeof eventData];

/** A decoded governance event with where it came from. */
export type GovEvent = GovEventBody & EventMeta;

/** One page of events. */
export interface EventPage {
  events: GovEvent[];
  /** Pass back to get the next page. */
  cursor: string;
  latestLedger: number;
  oldestLedger: number;
}

/** The latest closed ledger. */
export interface LedgerInfo {
  sequence: number;
  /** Close time in seconds since the epoch, from the ledger itself (not the local clock). */
  closeTime: number;
}

/** What the RPC server still has. */
export interface RetentionInfo {
  latestLedger: number;
  oldestLedger: number;
}
