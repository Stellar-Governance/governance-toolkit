import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { contentHash } from '../discussion/drafts.js';
import { Indexer } from '../indexer/indexer.js';
import { testApi, type TestApi } from '../testing/api.js';
import { FakeChain, sampleProposal } from '../testing/fake-chain.js';
import { buildServer } from './server.js';

const A = 'GDA6HEAZTBUTUVVLTQAQURAFKXJSSXGCAURILN6QIRDFIJPLBWOLWNNT';
const B = 'GARQQ444KKYHFWFQHRZERDNNO74IHV7JZF5HYEMQ7ZJLFCABVE4QQAEW';
const C = 'GAFE6DFMIYL64SLPK6LURMWUMICBIJ7TDJIHDXMGSL7D5W3QPKLYWV4N';
const TEXT = 'Full text of proposal one.';

interface Page<T> {
  items: T[];
  next: string | null;
}
interface ProposalJson {
  id: number;
  state: string;
  final: boolean;
  proposer: string;
  forVotes: string;
  texts?: { id: string; body: string; contentHash: string }[];
}
interface VoteJson {
  proposalId: number;
  voter: string;
  choice: string;
  power: string;
  eventId: string;
}

const apis: TestApi[] = [];
afterEach(async () => {
  for (const a of apis.splice(0)) await a.close();
});

/** An API whose store was filled by the indexer from a fake chain with 3 proposals. */
async function populated(): Promise<TestApi> {
  const a = testApi();
  apis.push(a);
  const chain = new FakeChain();
  chain.proposals.push({
    proposal: sampleProposal({
      title: 'One',
      descriptionHash: contentHash(TEXT),
      forVotes: 600n,
      againstVotes: 400n,
      totalPower: 1_000n,
    }),
    state: 'Executed',
  });
  chain.proposals.push({
    proposal: sampleProposal({ title: 'Two', proposer: B }),
    state: 'Active',
  });
  chain.proposals.push({ proposal: sampleProposal({ title: 'Three' }), state: 'Defeated' });
  chain.oldestLedger = 5;
  chain.emit({ kind: 'deposited', account: A, amount: 600n, deposit: 600n, total: 600n }, 10);
  chain.emit({ kind: 'deposited', account: B, amount: 400n, deposit: 400n, total: 1_000n }, 11);
  chain.emit({ kind: 'vote_cast', proposalId: 1n, voter: A, choice: 'For', power: 600n }, 12);
  chain.emit({ kind: 'vote_cast', proposalId: 1n, voter: B, choice: 'Against', power: 400n }, 13);
  chain.emit({ kind: 'vote_cast', proposalId: 2n, voter: A, choice: 'Abstain', power: 600n }, 14);
  chain.emit({ kind: 'withdrawn', account: B, amount: 400n, deposit: 0n, total: 600n }, 15);
  // Published text of proposal 1, so it gets linked.
  const author = await a.signIn();
  await a.drafts.create(author.address, { title: 'One', body: TEXT, status: 'published' });
  await new Indexer({ chain, store: a.store, startLedger: 1, now: () => 77 }).runOnce();
  return a;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T only names the expected JSON shape in tests
const get = async <T>(a: TestApi, url: string) => {
  const res = await a.app.inject({ method: 'GET', url });
  return { status: res.statusCode, body: res.json<T>() };
};

describe('read API', () => {
  it('reports health without calling the chain', async () => {
    const a = await populated();
    a.health.lastSuccessAt = 123;
    const r = await get<{ status: string; network: string; indexer: Record<string, unknown> }>(
      a,
      '/health',
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'ok', network: 'testnet' });
    expect(r.body.indexer).toMatchObject({ lastSuccessAt: 123, lastError: null, gaps: 1 });
    expect(typeof r.body.indexer.nextLedger).toBe('number');
  });

  it('lists proposals newest first with filters and pagination', async () => {
    const a = await populated();
    const all = await get<Page<ProposalJson>>(a, '/proposals');
    expect(all.body.items.map((p) => p.id)).toEqual([3, 2, 1]);
    expect(all.body.items[2]).toMatchObject({ state: 'Executed', final: true, forVotes: '600' });
    expect(all.body.next).toBeNull();
    const active = await get<Page<ProposalJson>>(a, '/proposals?state=Active');
    expect(active.body.items.map((p) => p.id)).toEqual([2]);
    const byB = await get<Page<ProposalJson>>(a, `/proposals?proposer=${B}`);
    expect(byB.body.items.map((p) => p.proposer)).toEqual([B]);
    const page1 = await get<Page<ProposalJson>>(a, '/proposals?limit=2');
    expect(page1.body.items.map((p) => p.id)).toEqual([3, 2]);
    expect(page1.body.next).toBe('2');
    const page2 = await get<Page<ProposalJson>>(
      a,
      `/proposals?limit=2&cursor=${String(page1.body.next)}`,
    );
    expect(page2.body.items.map((p) => p.id)).toEqual([1]);
  });

  it('rejects invalid list queries', async () => {
    const a = await populated();
    for (const url of [
      '/proposals?state=Nope',
      '/proposals?proposer=G123',
      '/proposals?limit=0',
      '/proposals?limit=201',
      '/proposals?cursor=-1',
      '/proposals?unknown=1',
    ]) {
      const r = await get<{ error: { code: string } }>(a, url);
      expect(r.status, url).toBe(400);
      expect(r.body.error.code).toBe('VALIDATION');
    }
  });

  it('returns one proposal with its linked public text', async () => {
    const a = await populated();
    const r = await get<ProposalJson>(a, '/proposals/1');
    expect(r.status).toBe(200);
    expect(r.body.texts?.map((t) => t.body)).toEqual([TEXT]);
    expect(r.body.texts?.[0]?.contentHash).toBe(contentHash(TEXT));
    const two = await get<ProposalJson>(a, '/proposals/2');
    expect(two.body.texts).toEqual([]);
    expect((await get(a, '/proposals/99')).status).toBe(404);
    expect((await get(a, '/proposals/abc')).status).toBe(400);
    expect((await get(a, '/proposals/0')).status).toBe(400);
  });

  it("pages a proposal's votes from events", async () => {
    const a = await populated();
    const r = await get<Page<VoteJson>>(a, '/proposals/1/votes?limit=1');
    expect(r.body.items.map((v) => [v.voter, v.choice, v.power])).toEqual([[A, 'For', '600']]);
    const next = await get<Page<VoteJson>>(
      a,
      `/proposals/1/votes?limit=1&cursor=${String(r.body.next)}`,
    );
    expect(next.body.items.map((v) => v.voter)).toEqual([B]);
    expect((await get(a, '/proposals/99/votes')).status).toBe(404);
    expect((await get(a, '/proposals/1/votes?cursor=bad')).status).toBe(400);
  });

  it('describes an account: latest deposit seen and votes cast', async () => {
    const a = await populated();
    const r = await get<{ deposit: string | null; votes: VoteJson[] }>(a, `/accounts/${A}`);
    expect(r.body.deposit).toBe('600');
    expect(r.body.votes.map((v) => v.proposalId)).toEqual([1, 2]);
    const b = await get<{ deposit: string | null }>(a, `/accounts/${B}`);
    expect(b.body.deposit).toBe('0');
    const c = await get<{ deposit: string | null; votes: unknown[] }>(a, `/accounts/${C}`);
    expect(c.body).toMatchObject({ deposit: null, votes: [] });
    expect((await get(a, '/accounts/nope')).status).toBe(400);
  });

  it('serves summary statistics with the as-of time and gaps', async () => {
    const a = await populated();
    const r = await get<{
      asOf: number;
      proposals: { total: number; byState: Record<string, number> };
      votes: { indexed: number; uniqueVoters: number };
      accounts: { withDeposit: number };
      gaps: { fromLedger: number; toLedger: number }[];
    }>(a, '/stats/summary');
    expect(r.body.proposals).toEqual({
      total: 3,
      byState: { Executed: 1, Active: 1, Defeated: 1 },
    });
    expect(r.body.votes).toEqual({ indexed: 3, uniqueVoters: 2 });
    expect(r.body.accounts).toEqual({ withDeposit: 1 });
    expect(r.body.asOf).toBeGreaterThan(0);
    expect(r.body.gaps).toEqual([{ fromLedger: 1, toLedger: 4, recordedAt: 77 }]);
  });

  it('serves raw per-proposal numbers oldest first, and every vote', async () => {
    const a = await populated();
    const r = await get<
      Page<{ id: number; indexedVoters: number; final: boolean; totalPower: string }> & {
        gaps: unknown[];
      }
    >(a, '/stats/proposals?limit=2');
    expect(r.body.items.map((p) => [p.id, p.indexedVoters, p.final])).toEqual([
      [1, 2, true],
      [2, 1, false],
    ]);
    expect(r.body.items[0]?.totalPower).toBe('1000');
    expect(r.body.gaps).toHaveLength(1);
    const rest = await get<Page<{ id: number }>>(
      a,
      `/stats/proposals?limit=2&cursor=${String(r.body.next)}`,
    );
    expect(rest.body.items.map((p) => p.id)).toEqual([3]);
    const votes = await get<Page<VoteJson>>(a, '/stats/votes');
    expect(votes.body.items).toHaveLength(3);
    expect((await get(a, '/stats/proposals?limit=abc')).status).toBe(400);
  });
});

describe('openapi.yaml', () => {
  it('documents exactly the routes the server registers', () => {
    const registered = new Set<string>();
    const a = testApi();
    apis.push(a);
    buildServer(
      {
        store: a.store,
        auth: a.auth,
        drafts: a.drafts,
        comments: a.comments,
        corsOrigins: [],
        service: { version: 'x', network: 'testnet', contractId: 'C', health: () => a.health },
      },
      { onRoute: (r) => registered.add(`${r.method} ${r.url.replace(/:(\w+)/g, '{$1}')}`) },
    );
    const yaml = readFileSync(new URL('../../openapi.yaml', import.meta.url), 'utf8');
    const documented = new Set<string>();
    let path: string | undefined;
    for (const line of yaml.split('\n')) {
      const p = /^ {2}(\/\S*):$/.exec(line);
      if (p?.[1] !== undefined) {
        path = p[1];
        continue;
      }
      const m = /^ {4}(get|post|patch|delete|put):$/.exec(line);
      if (m?.[1] !== undefined && path !== undefined)
        documented.add(`${m[1].toUpperCase()} ${path}`);
      if (/^\S/.test(line)) path = undefined;
    }
    expect(registered.size).toBeGreaterThanOrEqual(20);
    expect([...documented].sort()).toEqual([...registered].sort());
  });
});
