/**
 * In-memory {@link ChainClient} for tests. Proposals, events and the retention window are set by
 * the test; `events` pages through them like the RPC does (cursor = index of the next event).
 */
import type { ChainClient, EventQuery } from '../chain/client.js';
import type {
  ChainProposal,
  ChainVote,
  EventPage,
  GovConfig,
  GovEvent,
  GovEventBody,
  LedgerInfo,
  ProposalStateName,
  RetentionInfo,
} from '../chain/types.js';
import { ContractCallError, RpcResponseError } from '../errors.js';

/** A proposal plus the state the fake reports for it. */
export interface FakeProposal {
  proposal: ChainProposal;
  state: ProposalStateName;
}

/** A sample proposal; override fields as needed. */
export function sampleProposal(overrides: Partial<ChainProposal> = {}): ChainProposal {
  return {
    proposer: 'GDA6HEAZTBUTUVVLTQAQURAFKXJSSXGCAURILN6QIRDFIJPLBWOLWNNT',
    title: 'Sample',
    descriptionHash: 'ab'.repeat(32),
    uri: 'https://example.org/p',
    actions: [],
    snapshotLedger: 100,
    voteStart: 1_000,
    voteEnd: 2_000,
    totalPower: 1_000n,
    quorum: 200n,
    timelockSecs: 60,
    gracePeriodSecs: 86_400,
    forVotes: 0n,
    againstVotes: 0n,
    abstainVotes: 0n,
    eta: 0,
    executed: false,
    canceled: false,
    ...overrides,
  };
}

/** Test double for the chain. */
export class FakeChain implements ChainClient {
  proposals: FakeProposal[] = [];
  private eventLog: GovEvent[] = [];
  latest: LedgerInfo = { sequence: 15, closeTime: 1_700_000_000 };
  oldestLedger = 1;
  config_: GovConfig = {
    votingDelaySecs: 30,
    votingPeriodSecs: 120,
    timelockSecs: 60,
    gracePeriodSecs: 86_400,
    proposalThreshold: 10n,
    quorumBps: 2_000,
  };
  /** Every events() query, for assertions. */
  readonly eventQueries: EventQuery[] = [];
  /** Cursors the fake refuses, to test recovery. */
  readonly rejectedCursors = new Set<string>();
  /** Count of proposal reads, for assertions. */
  proposalReads = 0;

  /** Appends an event at `ledger` (ids are ordered like RPC ids). */
  emit(body: GovEventBody, ledger: number, txHash = 'f'.repeat(64)): GovEvent {
    const index = this.eventLog.length;
    const event: GovEvent = {
      ...body,
      id: `${String(ledger).padStart(19, '0')}-${String(index).padStart(10, '0')}`,
      ledger,
      closedAt: new Date((1_700_000_000 + ledger * 5) * 1000).toISOString(),
      txHash,
    };
    this.eventLog.push(event);
    if (ledger >= this.latest.sequence) this.latest = { ...this.latest, sequence: ledger + 1 };
    return event;
  }

  /** @inheritdoc */
  latestLedger(): Promise<LedgerInfo> {
    return Promise.resolve(this.latest);
  }

  /** @inheritdoc */
  retention(): Promise<RetentionInfo> {
    return Promise.resolve({ latestLedger: this.latest.sequence, oldestLedger: this.oldestLedger });
  }

  /** @inheritdoc */
  proposalCount(): Promise<bigint> {
    return Promise.resolve(BigInt(this.proposals.length));
  }

  private find(id: bigint, fn: string): FakeProposal {
    const p = this.proposals[Number(id) - 1];
    if (p === undefined) throw new ContractCallError(fn, 8, 'ProposalNotFound');
    return p;
  }

  /** @inheritdoc */
  proposal(id: bigint): Promise<ChainProposal> {
    this.proposalReads++;
    return Promise.resolve(this.find(id, 'get_proposal').proposal);
  }

  /** @inheritdoc */
  proposalState(id: bigint): Promise<ProposalStateName> {
    return Promise.resolve(this.find(id, 'state').state);
  }

  /** @inheritdoc */
  vote(): Promise<ChainVote | null> {
    return Promise.resolve(null);
  }

  /** @inheritdoc */
  config(): Promise<GovConfig> {
    return Promise.resolve(this.config_);
  }

  /** @inheritdoc */
  depositOf(): Promise<bigint> {
    return Promise.resolve(0n);
  }

  /** @inheritdoc */
  events(query: EventQuery, limit: number): Promise<EventPage> {
    this.eventQueries.push(query);
    let start: number;
    if ('cursor' in query) {
      if (this.rejectedCursors.has(query.cursor)) {
        return Promise.reject(new RpcResponseError('getEvents', -32600, 'invalid cursor'));
      }
      start = Number(query.cursor);
    } else {
      if (query.startLedger < this.oldestLedger) {
        return Promise.reject(
          new RpcResponseError('getEvents', -32600, 'startLedger must be within retention'),
        );
      }
      start = this.eventLog.findIndex((e) => e.ledger >= query.startLedger);
      if (start === -1) start = this.eventLog.length;
    }
    const visible = this.eventLog.slice(start).filter((e) => e.ledger >= this.oldestLedger);
    const events = visible.slice(0, limit);
    return Promise.resolve({
      events,
      cursor: String(start + events.length),
      latestLedger: this.latest.sequence,
      oldestLedger: this.oldestLedger,
    });
  }
}
