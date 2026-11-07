import { afterEach, describe, expect, it } from 'vitest';
import { RpcTimeoutError } from '../errors.js';
import { SqliteStore } from '../store/sqlite.js';
import { FakeChain, sampleProposal } from '../testing/fake-chain.js';
import { Indexer } from './indexer.js';

const A = 'GDA6HEAZTBUTUVVLTQAQURAFKXJSSXGCAURILN6QIRDFIJPLBWOLWNNT';
const B = 'GARQQ444KKYHFWFQHRZERDNNO74IHV7JZF5HYEMQ7ZJLFCABVE4QQAEW';

const stores: SqliteStore[] = [];
afterEach(async () => {
  for (const s of stores.splice(0)) await s.close();
});

function setup(options: { startLedger?: number; pageSize?: number; maxPages?: number } = {}) {
  const chain = new FakeChain();
  const store = new SqliteStore(':memory:');
  stores.push(store);
  const logs: string[] = [];
  const indexer = new Indexer({
    chain,
    store,
    startLedger: options.startLedger ?? 10,
    pageSize: options.pageSize ?? 100,
    maxPages: options.maxPages ?? 50,
    now: () => 42,
    log: (m) => logs.push(m),
  });
  return { chain, store, indexer, logs };
}

const vote = (proposalId: bigint, voter: string, power: bigint) => ({
  kind: 'vote_cast' as const,
  proposalId,
  voter,
  choice: 'For' as const,
  power,
});
const deposit = (account: string, amount: bigint, after: bigint) => ({
  kind: 'deposited' as const,
  account,
  amount,
  deposit: after,
  total: after,
});

describe('Indexer', () => {
  it('stores new proposals with their state', async () => {
    const { chain, store, indexer } = setup();
    chain.proposals.push({ proposal: sampleProposal({ title: 'One' }), state: 'Active' });
    chain.proposals.push({ proposal: sampleProposal({ title: 'Two' }), state: 'Pending' });
    const r = await indexer.runOnce();
    expect(r.newProposals).toBe(2);
    expect((await store.getProposal(1))?.title).toBe('One');
    expect((await store.getProposal(2))?.state).toBe('Pending');
    expect((await store.getProposal(1))?.checkedAt).toBe(chain.latest.closeTime);
  });

  it('refreshes open proposals and stops reading final ones', async () => {
    const { chain, store, indexer } = setup();
    chain.proposals.push({ proposal: sampleProposal(), state: 'Active' });
    chain.proposals.push({ proposal: sampleProposal(), state: 'Executed' });
    await indexer.runOnce();
    const first = chain.proposals[0];
    if (first === undefined) throw new Error('setup');
    first.state = 'Defeated';
    first.proposal = { ...first.proposal, againstVotes: 300n };
    chain.proposalReads = 0;
    const r = await indexer.runOnce();
    expect(r.refreshedProposals).toBe(1);
    expect(chain.proposalReads).toBe(1);
    expect(await store.getProposal(1)).toMatchObject({ state: 'Defeated', againstVotes: '300' });
    chain.proposalReads = 0;
    await indexer.runOnce();
    expect(chain.proposalReads).toBe(0);
  });

  it('indexes votes and deposits from events, once, even when replayed', async () => {
    const { chain, store, indexer } = setup();
    chain.proposals.push({ proposal: sampleProposal(), state: 'Active' });
    chain.emit(deposit(A, 600n, 600n), 20);
    chain.emit(vote(1n, A, 600n), 21);
    chain.emit(vote(1n, B, 400n), 22);
    const r = await indexer.runOnce();
    expect(r.events).toBe(3);
    expect((await store.listVotes(1, { limit: 10 })).map((v) => v.voter)).toEqual([A, B]);
    expect((await store.getAccount(A))?.deposit).toBe('600');
    // Replay everything by rewinding the cursor: nothing is duplicated.
    await store.commitEvents({ votes: [], deposits: [], cursor: { cursor: null, nextLedger: 10 } });
    await indexer.runOnce();
    expect(await store.listVotes(1, { limit: 10 })).toHaveLength(2);
    expect(await store.votesByVoter(A)).toHaveLength(1);
  });

  it('resumes from the stored cursor after a restart', async () => {
    const first = setup();
    first.chain.emit(vote(1n, A, 1n), 20);
    await first.indexer.runOnce();
    const cursor = await first.store.getCursor();
    expect(cursor?.cursor).toBe('1');
    // A new indexer on the same store (a restarted service) continues from the cursor.
    first.chain.emit(vote(1n, B, 2n), 30);
    const restarted = new Indexer({ chain: first.chain, store: first.store, startLedger: 10 });
    const r = await restarted.runOnce();
    expect(r.events).toBe(1);
    expect(first.chain.eventQueries.at(-1)).toEqual({ cursor: '1' });
    expect(await first.store.listVotes(1, { limit: 10 })).toHaveLength(2);
  });

  it('pages through many events and stops at maxPages', async () => {
    const { chain, store, indexer } = setup({ pageSize: 2, maxPages: 2 });
    for (let i = 0; i < 5; i++) chain.emit(deposit(A, 1n, BigInt(i + 1)), 20 + i);
    const r = await indexer.runOnce();
    expect(r.events).toBe(4);
    expect(r.moreEvents).toBe(true);
    const r2 = await indexer.runOnce();
    expect(r2.events).toBe(1);
    expect(r2.moreEvents).toBe(false);
    expect((await store.getAccount(A))?.deposit).toBe('5');
  });

  it('records a gap when the start ledger is older than RPC retention', async () => {
    const { chain, store, indexer, logs } = setup({ startLedger: 10 });
    chain.oldestLedger = 500;
    chain.emit(vote(1n, A, 1n), 600);
    const r = await indexer.runOnce();
    expect(r.gap).toEqual({ fromLedger: 10, toLedger: 499 });
    expect(await store.listGaps()).toEqual([{ fromLedger: 10, toLedger: 499, recordedAt: 42 }]);
    expect(chain.eventQueries[0]).toEqual({ startLedger: 500 });
    expect(r.events).toBe(1);
    expect(logs[0]).toMatch(/gap/);
  });

  it('records a gap when the stored cursor has fallen out of retention', async () => {
    const { chain, store, indexer } = setup();
    chain.emit(vote(1n, A, 1n), 20);
    await indexer.runOnce();
    const before = await store.getCursor();
    // Time passes with the service stopped; the RPC drops old ledgers.
    chain.emit(vote(1n, B, 1n), 3_000);
    chain.oldestLedger = 2_000;
    const r = await indexer.runOnce();
    expect(r.gap).toEqual({ fromLedger: before?.nextLedger, toLedger: 1_999 });
    expect(chain.eventQueries.at(-1)).toEqual({ startLedger: 2_000 });
    expect((await store.listGaps()).map((g) => g.fromLedger)).toEqual([before?.nextLedger]);
    expect(await store.votesByVoter(B)).toHaveLength(1);
  });

  it('starts again from the stored ledger when the RPC rejects the cursor', async () => {
    const { chain, store, indexer, logs } = setup();
    chain.emit(vote(1n, A, 1n), 20);
    await indexer.runOnce();
    chain.rejectedCursors.add('1');
    chain.emit(vote(1n, B, 1n), 25);
    await indexer.runOnce();
    expect(await store.listVotes(1, { limit: 10 })).toHaveLength(2);
    expect(logs.some((l) => l.includes('rejected the stored cursor'))).toBe(true);
  });

  it('fails the run on an RPC timeout and leaves the store consistent', async () => {
    const { chain, store, indexer } = setup();
    chain.emit(vote(1n, A, 1n), 20);
    chain.events = () => Promise.reject(new RpcTimeoutError('getEvents', 30_000));
    await expect(indexer.runOnce()).rejects.toBeInstanceOf(RpcTimeoutError);
    expect(await store.getCursor()).toBeUndefined();
    expect(await store.listVotes(1, { limit: 10 })).toEqual([]);
  });
});
