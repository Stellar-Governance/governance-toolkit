import { readFileSync } from 'node:fs';
import { Networks } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { ContractCallError, MalformedResponseError } from '../errors.js';
import { contractErrorCode, RpcChainClient } from './client.js';
import type { RpcTransport } from './transport.js';

const CONTRACT_ID = 'CAOERDLG52UU6X5JENOXNKN4DWWJPVPNK7AD4RYXE3MA4TRBY62O5I5F';
const VOTER_A = 'GDA6HEAZTBUTUVVLTQAQURAFKXJSSXGCAURILN6QIRDFIJPLBWOLWNNT';
const VOTER_B = 'GARQQ444KKYHFWFQHRZERDNNO74IHV7JZF5HYEMQ7ZJLFCABVE4QQAEW';

type Recorded = Record<string, { method: string; result: unknown }>;
const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/testnet-2026-11-07.json', import.meta.url), 'utf8'),
) as Recorded;

function fixture(name: string): unknown {
  const f = fixtures[name];
  if (f === undefined) throw new Error(`no fixture ${name}`);
  return f.result;
}

/** A fake RPC that answers each request with the next queued result and records the calls. */
function fakeRpc(results: unknown[]) {
  const calls: { method: string; params: unknown }[] = [];
  const transport: RpcTransport = {
    request(method, params) {
      calls.push({ method, params });
      if (results.length === 0) return Promise.reject(new Error('unexpected request'));
      return Promise.resolve(results.shift());
    },
  };
  const client = new RpcChainClient({
    transport,
    contractId: CONTRACT_ID,
    networkPassphrase: Networks.TESTNET,
    rpcUrl: 'https://rpc.example',
  });
  return { client, calls };
}

describe('RpcChainClient reads (recorded testnet responses)', () => {
  it('decodes proposal 1', async () => {
    const { client, calls } = fakeRpc([fixture('get_proposal_1')]);
    const p = await client.proposal(1n);
    expect(calls[0]?.method).toBe('simulateTransaction');
    expect(p).toMatchObject({
      proposer: VOTER_A,
      title: 'Rehearsal 1',
      descriptionHash: 'ea8225aff34d61b1cd98624f65b0cd3ee4d78f73e6861bcdbdc4a311842ee699',
      uri: 'https://example.org/rehearsal-1',
      actions: [],
      snapshotLedger: 5_611_046,
      totalPower: 8_000_000_000n,
      quorum: 1_600_000_000n,
      forVotes: 5_000_000_000n,
      againstVotes: 3_000_000_000n,
      abstainVotes: 0n,
      executed: true,
      canceled: false,
      timelockSecs: 60,
      gracePeriodSecs: 86_400,
    });
    expect(p.voteEnd - p.voteStart).toBe(120);
  });

  it('decodes count, state, config, votes and deposits', async () => {
    const { client } = fakeRpc([
      fixture('proposal_count'),
      fixture('state_1'),
      fixture('get_config'),
      fixture('get_vote_1_a'),
      fixture('get_vote_1_none'),
      fixture('deposit_of_a'),
    ]);
    expect(await client.proposalCount()).toBe(1n);
    expect(await client.proposalState(1n)).toBe('Executed');
    expect(await client.config()).toEqual({
      votingDelaySecs: 30,
      votingPeriodSecs: 120,
      timelockSecs: 60,
      gracePeriodSecs: 86_400,
      proposalThreshold: 10_000_000n,
      quorumBps: 2_000,
    });
    expect(await client.vote(1n, VOTER_A)).toEqual({ choice: 'For', power: 5_000_000_000n });
    expect(await client.vote(1n, VOTER_B)).toBeNull();
    expect(await client.depositOf(VOTER_A)).toBe(5_000_000_000n);
  });

  it('reads the latest ledger close time from the ledger, and the retention window', async () => {
    const { client } = fakeRpc([fixture('getLatestLedger'), fixture('getHealth')]);
    const l = await client.latestLedger();
    expect(l.sequence).toBeGreaterThan(5_611_001);
    expect(l.closeTime).toBeGreaterThan(1_794_000_000);
    const r = await client.retention();
    expect(r.latestLedger).toBeGreaterThan(r.oldestLedger);
  });

  it('decodes the events of the lifecycle rehearsal in order', async () => {
    const { client, calls } = fakeRpc([fixture('getEvents')]);
    const page = await client.events({ startLedger: 5_611_001 }, 100);
    expect(calls[0]).toEqual({
      method: 'getEvents',
      params: {
        filters: [{ type: 'contract', contractIds: [CONTRACT_ID] }],
        pagination: { limit: 100 },
        startLedger: 5_611_001,
      },
    });
    expect(page.events.map((e) => e.kind)).toEqual([
      'deposited',
      'deposited',
      'proposal_created',
      'vote_cast',
      'vote_cast',
      'proposal_queued',
      'proposal_executed',
    ]);
    const vote = page.events[3];
    expect(vote).toMatchObject({ kind: 'vote_cast', proposalId: 1n, voter: VOTER_A });
    expect(vote?.txHash).toBe('1e8f0ead2b269c92edbf91630462ab751fbdc2c7d1de9b5fa06bfc3357aa0af3');
    expect(page.cursor.length).toBeGreaterThan(0);
  });

  it('sends the cursor instead of a start ledger on later pages', async () => {
    const { client, calls } = fakeRpc([
      { latestLedger: 10, oldestLedger: 1, cursor: 'c2', events: [] },
    ]);
    await client.events({ cursor: 'c1' }, 50);
    expect(calls[0]?.params).toEqual({
      filters: [{ type: 'contract', contractIds: [CONTRACT_ID] }],
      pagination: { cursor: 'c1', limit: 50 },
    });
  });
});

describe('RpcChainClient failures', () => {
  it('maps a simulation failure with a contract code to ContractCallError', async () => {
    const { client } = fakeRpc([fixture('get_proposal_missing')]);
    const err = await client.proposal(9_999_999n).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ContractCallError);
    expect(err).toMatchObject({ contractCode: 8, contractError: 'ProposalNotFound', status: 422 });
  });

  it('reports a simulation failure without a contract code as malformed', async () => {
    const { client } = fakeRpc([
      { latestLedger: 1, error: 'HostError: Error(Budget, ExceededLimit)' },
    ]);
    await expect(client.proposalCount()).rejects.toBeInstanceOf(MalformedResponseError);
  });

  it('rejects responses of the wrong shape', async () => {
    const noResults = fakeRpc([{ latestLedger: 1 }]);
    await expect(noResults.client.proposalCount()).rejects.toBeInstanceOf(MalformedResponseError);
    const badXdr = fakeRpc([{ latestLedger: 1, results: [{ xdr: 'not-xdr' }] }]);
    await expect(badXdr.client.proposalCount()).rejects.toBeInstanceOf(MalformedResponseError);
    // A valid ScVal of the wrong type for the function (a u64 where a Proposal is expected).
    const wrongType = fakeRpc([fixture('proposal_count')]);
    await expect(wrongType.client.proposal(1n)).rejects.toBeInstanceOf(MalformedResponseError);
    const badLedger = fakeRpc([{ sequence: 'x' }]);
    await expect(badLedger.client.latestLedger()).rejects.toBeInstanceOf(MalformedResponseError);
    const badEvents = fakeRpc([{ events: 'nope' }]);
    await expect(badEvents.client.events({ startLedger: 1 }, 10)).rejects.toBeInstanceOf(
      MalformedResponseError,
    );
  });

  it('skips events from failed calls, other contracts and unknown names', async () => {
    const real = fixture('getEvents') as { events: Record<string, unknown>[] };
    const [first, second, third] = real.events;
    const page = {
      latestLedger: 10,
      oldestLedger: 1,
      cursor: 'c',
      events: [
        { ...first, inSuccessfulContractCall: false },
        { ...second, contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC' },
        { ...third, topic: ['AAAADwAAAAdtaXN0ZXJ5AA=='] },
      ],
    };
    const { client } = fakeRpc([page]);
    const result = await client.events({ startLedger: 1 }, 10);
    expect(result.events).toEqual([]);
  });

  it('parses contract error codes out of simulation errors', () => {
    expect(contractErrorCode('HostError: Error(Contract, #12)\n\nEvent log')).toBe(12);
    expect(contractErrorCode('HostError: Error(Auth, InvalidAction)')).toBeUndefined();
  });
});
