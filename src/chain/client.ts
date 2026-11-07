import { Account, BASE_FEE, Contract, TransactionBuilder } from '@stellar/stellar-sdk';
import type { contract } from '@stellar/stellar-sdk';
import { z } from 'zod';
import { Client as BindingsClient, Error as CONTRACT_ERRORS } from '../contract/index.js';
import { ContractCallError, MalformedResponseError } from '../errors.js';
import type { RpcTransport } from './transport.js';
import {
  configSchema,
  EVENT_SCHEMAS,
  proposalSchema,
  stateSchema,
  voteRecordSchema,
  type ChainProposal,
  type ChainVote,
  type EventPage,
  type GovConfig,
  type GovEvent,
  type LedgerInfo,
  type ProposalStateName,
  type RetentionInfo,
} from './types.js';

/** Where to start reading events: a ledger (first read) or a cursor from a previous page. */
export type EventQuery = { startLedger: number } | { cursor: string };

/** Read access to the governance contract and the network. */
export interface ChainClient {
  /** Latest closed ledger, with the ledger's own close time. */
  latestLedger(): Promise<LedgerInfo>;
  /** Ledgers the RPC server still has events for. */
  retention(): Promise<RetentionInfo>;
  /** Number of proposals created (ids are 1..count). */
  proposalCount(): Promise<bigint>;
  /**
   * A proposal by id.
   * @throws {ContractCallError} `ProposalNotFound` (#8) for an unknown id
   */
  proposal(id: bigint): Promise<ChainProposal>;
  /** Current state of a proposal. */
  proposalState(id: bigint): Promise<ProposalStateName>;
  /** How `voter` voted on proposal `id`, or `null`. */
  vote(id: bigint, voter: string): Promise<ChainVote | null>;
  /** Current settings. */
  config(): Promise<GovConfig>;
  /** Current deposit of `account`. */
  depositOf(account: string): Promise<bigint>;
  /** One page of this contract's events, oldest first. Unknown events are skipped. */
  events(query: EventQuery, limit: number): Promise<EventPage>;
}

/** An account id with all-zero key: simulation needs a source but never checks it. */
const NULL_ACCOUNT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

const simulateResponse = z.object({
  latestLedger: z.number(),
  error: z.string().optional(),
  results: z.array(z.object({ xdr: z.string() })).optional(),
});

const latestLedgerResponse = z.object({
  sequence: z.number().int().positive(),
  closeTime: z.union([z.string(), z.number()]).transform((t) => Number(t)),
});

const healthResponse = z.object({
  latestLedger: z.number().int(),
  oldestLedger: z.number().int(),
});

const eventsResponse = z.object({
  latestLedger: z.number().int(),
  oldestLedger: z.number().int().optional(),
  cursor: z.string(),
  events: z.array(
    z.object({
      id: z.string(),
      ledger: z.number().int(),
      ledgerClosedAt: z.string(),
      txHash: z.string(),
      contractId: z.string().optional(),
      inSuccessfulContractCall: z.boolean().optional(),
      topic: z.array(z.string()).optional(),
      value: z.string(),
    }),
  ),
});

/** Parses `Error(Contract, #N)` out of a simulation error string. */
export function contractErrorCode(simulationError: string): number | undefined {
  const m = /Error\(Contract, #(\d+)\)/.exec(simulationError);
  return m?.[1] === undefined ? undefined : Number(m[1]);
}

function contractErrorName(code: number): string {
  const entry = (CONTRACT_ERRORS as Record<number, { message: string } | undefined>)[code];
  return entry?.message ?? 'Unknown';
}

function parseWith<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new MalformedResponseError(what, r.error.issues.map((i) => i.message).join('; '));
  }
  return r.data;
}

/** Options for {@link RpcChainClient}. */
export interface RpcChainClientOptions {
  transport: RpcTransport;
  contractId: string;
  networkPassphrase: string;
  /** RPC URL, given to the bindings client that holds the contract spec (it never connects). */
  rpcUrl: string;
}

/**
 * {@link ChainClient} over Stellar RPC. Contract reads are simulated transactions (no fee, no
 * signature). Arguments and results are encoded and decoded with the contract spec from the
 * generated bindings, then validated with zod.
 */
export class RpcChainClient implements ChainClient {
  private readonly spec: contract.Spec;
  private readonly contract: Contract;

  /** @param options - transport, contract id and network passphrase */
  constructor(private readonly options: RpcChainClientOptions) {
    // The bindings client is only used for its spec; it opens no connection.
    this.spec = new BindingsClient({
      contractId: options.contractId,
      networkPassphrase: options.networkPassphrase,
      rpcUrl: options.rpcUrl,
      allowHttp: true,
    }).spec;
    this.contract = new Contract(options.contractId);
  }

  /**
   * Simulates a read-only call and returns the decoded native result.
   * @throws {ContractCallError} when the contract returns one of its error codes
   * @throws {MalformedResponseError} when the response does not have the expected shape
   */
  private async read(fn: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const tx = new TransactionBuilder(new Account(NULL_ACCOUNT, '0'), {
      fee: BASE_FEE,
      networkPassphrase: this.options.networkPassphrase,
    })
      .addOperation(this.contract.call(fn, ...this.spec.funcArgsToScVals(fn, args)))
      .setTimeout(30)
      .build();
    const raw = await this.options.transport.request('simulateTransaction', {
      transaction: tx.toXdr(),
    });
    const sim = parseWith(simulateResponse, raw, `simulateTransaction(${fn})`);
    if (sim.error !== undefined) {
      const code = contractErrorCode(sim.error);
      if (code !== undefined) throw new ContractCallError(fn, code, contractErrorName(code));
      throw new MalformedResponseError(
        `simulateTransaction(${fn})`,
        sim.error.split('\n')[0] ?? '',
      );
    }
    const first = sim.results?.[0];
    if (first === undefined) {
      throw new MalformedResponseError(`simulateTransaction(${fn})`, 'no result');
    }
    let decoded: unknown;
    try {
      decoded = this.spec.funcResToNative(fn, first.xdr);
    } catch (e) {
      throw new MalformedResponseError(`simulateTransaction(${fn})`, 'result does not decode', e);
    }
    // Result<T, E> outputs decode to Ok/Err wrappers; simulation errors were handled above.
    if (decoded !== null && typeof decoded === 'object' && 'isOk' in decoded) {
      const result = decoded as contract.Result<unknown>;
      if (result.isErr()) {
        throw new MalformedResponseError(`simulateTransaction(${fn})`, 'error result without code');
      }
      return result.unwrap();
    }
    return decoded;
  }

  /** @inheritdoc */
  async latestLedger(): Promise<LedgerInfo> {
    const raw = await this.options.transport.request('getLatestLedger');
    const r = parseWith(latestLedgerResponse, raw, 'getLatestLedger');
    if (!Number.isSafeInteger(r.closeTime)) {
      throw new MalformedResponseError('getLatestLedger', 'closeTime is not a number');
    }
    return { sequence: r.sequence, closeTime: r.closeTime };
  }

  /** @inheritdoc */
  async retention(): Promise<RetentionInfo> {
    const raw = await this.options.transport.request('getHealth');
    const r = parseWith(healthResponse, raw, 'getHealth');
    return { latestLedger: r.latestLedger, oldestLedger: r.oldestLedger };
  }

  /** @inheritdoc */
  async proposalCount(): Promise<bigint> {
    return parseWith(z.bigint(), await this.read('proposal_count'), 'proposal_count');
  }

  /** @inheritdoc */
  async proposal(id: bigint): Promise<ChainProposal> {
    return parseWith(
      proposalSchema,
      await this.read('get_proposal', { proposal_id: id }),
      'get_proposal',
    );
  }

  /** @inheritdoc */
  async proposalState(id: bigint): Promise<ProposalStateName> {
    return parseWith(stateSchema, await this.read('state', { proposal_id: id }), 'state');
  }

  /** @inheritdoc */
  async vote(id: bigint, voter: string): Promise<ChainVote | null> {
    const v = await this.read('get_vote', { proposal_id: id, voter });
    return v === null || v === undefined ? null : parseWith(voteRecordSchema, v, 'get_vote');
  }

  /** @inheritdoc */
  async config(): Promise<GovConfig> {
    return parseWith(configSchema, await this.read('get_config'), 'get_config');
  }

  /** @inheritdoc */
  async depositOf(account: string): Promise<bigint> {
    return parseWith(z.bigint(), await this.read('deposit_of', { account }), 'deposit_of');
  }

  /** @inheritdoc */
  async events(query: EventQuery, limit: number): Promise<EventPage> {
    const params = {
      filters: [{ type: 'contract', contractIds: [this.options.contractId] }],
      pagination: 'cursor' in query ? { cursor: query.cursor, limit } : { limit },
      ...('startLedger' in query ? { startLedger: query.startLedger } : {}),
    };
    const raw = await this.options.transport.request('getEvents', params);
    const page = parseWith(eventsResponse, raw, 'getEvents');
    const events: GovEvent[] = [];
    for (const e of page.events) {
      if (e.inSuccessfulContractCall === false) continue;
      if (e.contractId !== undefined && e.contractId !== this.options.contractId) continue;
      let parsed: { name: string; data: Record<string, unknown> } | undefined;
      try {
        parsed = this.spec.parseEvent(e.topic ?? [], e.value);
      } catch (err) {
        throw new MalformedResponseError(`event ${e.id}`, 'does not decode', err);
      }
      if (parsed === undefined) continue;
      const schema = EVENT_SCHEMAS[parsed.name];
      if (schema === undefined) continue;
      const body = parseWith(schema, parsed.data, `event ${parsed.name} ${e.id}`);
      events.push({
        ...body,
        id: e.id,
        ledger: e.ledger,
        closedAt: e.ledgerClosedAt,
        txHash: e.txHash,
      });
    }
    return {
      events,
      cursor: page.cursor,
      latestLedger: page.latestLedger,
      oldestLedger: page.oldestLedger ?? 0,
    };
  }
}
