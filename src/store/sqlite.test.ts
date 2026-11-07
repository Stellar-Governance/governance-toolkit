import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { toStoredProposal } from '../indexer/indexer.js';
import { sampleProposal } from '../testing/fake-chain.js';
import { MIGRATIONS, SqliteStore } from './sqlite.js';
import type { StoredVote } from './types.js';

const A = 'GDA6HEAZTBUTUVVLTQAQURAFKXJSSXGCAURILN6QIRDFIJPLBWOLWNNT';
const B = 'GARQQ444KKYHFWFQHRZERDNNO74IHV7JZF5HYEMQ7ZJLFCABVE4QQAEW';

const stores: SqliteStore[] = [];
function memory(): SqliteStore {
  const s = new SqliteStore(':memory:');
  stores.push(s);
  return s;
}
afterEach(async () => {
  for (const s of stores.splice(0)) await s.close();
});

function vote(overrides: Partial<StoredVote> = {}): StoredVote {
  return {
    proposalId: 1,
    voter: A,
    choice: 'For',
    power: '600',
    ledger: 10,
    closedAt: '2026-11-07T19:15:56Z',
    txHash: 'a'.repeat(64),
    eventId: '0000000000000000010-0000000001',
    ...overrides,
  };
}

describe('SqliteStore', () => {
  it('creates the schema once and reopens an existing file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gov-store-'));
    try {
      const path = join(dir, 'db.sqlite');
      const first = new SqliteStore(path);
      await first.upsertProposal(toStoredProposal(1, sampleProposal(), 'Active', 5));
      await first.close();
      const second = new SqliteStore(path);
      expect((await second.getProposal(1))?.state).toBe('Active');
      await second.close();
      expect(MIGRATIONS.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stores, refreshes and lists proposals newest first with filters', async () => {
    const s = memory();
    await s.upsertProposal(toStoredProposal(1, sampleProposal(), 'Active', 1));
    await s.upsertProposal(
      toStoredProposal(2, sampleProposal({ proposer: B, totalPower: 2n ** 100n }), 'Pending', 1),
    );
    await s.upsertProposal(toStoredProposal(3, sampleProposal(), 'Defeated', 1));
    // Refresh changes tallies and state, keeps the rest.
    await s.upsertProposal(toStoredProposal(1, sampleProposal({ forVotes: 600n }), 'Succeeded', 9));
    const one = await s.getProposal(1);
    expect(one).toMatchObject({
      forVotes: '600',
      state: 'Succeeded',
      checkedAt: 9,
      title: 'Sample',
    });
    expect((await s.getProposal(2))?.totalPower).toBe((2n ** 100n).toString());
    expect((await s.listProposals({ limit: 10 })).map((p) => p.id)).toEqual([3, 2, 1]);
    expect((await s.listProposals({ limit: 10, proposer: B })).map((p) => p.id)).toEqual([2]);
    expect((await s.listProposals({ limit: 10, state: 'Defeated' })).map((p) => p.id)).toEqual([3]);
    expect((await s.listProposals({ limit: 1, beforeId: 3 })).map((p) => p.id)).toEqual([2]);
    expect(await s.maxProposalId()).toBe(3);
    expect(await s.openProposalIds()).toEqual([1, 2]);
    expect(await s.getProposal(99)).toBeUndefined();
  });

  it('keeps actions in JSON-safe form', async () => {
    const s = memory();
    const p = sampleProposal({
      actions: [
        {
          kind: 'UpdateConfig',
          config: {
            votingDelaySecs: 0,
            votingPeriodSecs: 300,
            timelockSecs: 60,
            gracePeriodSecs: 3_600,
            proposalThreshold: 5n,
            quorumBps: 5_000,
          },
        },
        {
          kind: 'Invoke',
          contract: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
          function: 'transfer',
          args: ['1'],
        },
      ],
    });
    await s.upsertProposal(toStoredProposal(1, p, 'Pending', 1));
    const stored = await s.getProposal(1);
    expect(stored?.actions[0]).toEqual({
      kind: 'UpdateConfig',
      config: expect.objectContaining({ proposalThreshold: '5', quorumBps: 5_000 }) as unknown,
    });
    expect(stored?.actions[1]).toMatchObject({ kind: 'Invoke', function: 'transfer' });
  });

  it('stores a vote once per proposal and voter, and keeps the newest deposit', async () => {
    const s = memory();
    const cursor = { cursor: 'c1', nextLedger: 11 };
    await s.commitEvents({ votes: [vote()], deposits: [], cursor });
    // Replay of the same event, and a second (impossible) vote by the same voter, change nothing.
    await s.commitEvents({
      votes: [vote(), vote({ choice: 'Against', eventId: '0000000000000000011-0000000001' })],
      deposits: [],
      cursor,
    });
    expect(await s.listVotes(1, { limit: 10 })).toEqual([vote()]);
    expect(await s.votesByVoter(A)).toHaveLength(1);

    const dep = (deposit: string, ledger: number, n: number) => ({
      address: A,
      deposit,
      ledger,
      eventId: `${String(ledger).padStart(19, '0')}-${String(n).padStart(10, '0')}`,
    });
    await s.commitEvents({ votes: [], deposits: [dep('100', 5, 1), dep('150', 5, 2)], cursor });
    expect((await s.getAccount(A))?.deposit).toBe('150');
    // An older event arriving later (a replay) does not overwrite the newer value.
    await s.commitEvents({ votes: [], deposits: [dep('100', 5, 1)], cursor });
    expect((await s.getAccount(A))?.deposit).toBe('150');
    await s.commitEvents({ votes: [], deposits: [dep('0', 7, 1)], cursor });
    expect((await s.getAccount(A))?.deposit).toBe('0');
    expect(await s.getAccount(B)).toBeUndefined();
  });

  it('pages votes by event id', async () => {
    const s = memory();
    const votes = [1, 2, 3].map((n) =>
      vote({
        voter:
          n === 1 ? A : n === 2 ? B : 'GAFE6DFMIYL64SLPK6LURMWUMICBIJ7TDJIHDXMGSL7D5W3QPKLYWV4N',
        eventId: `0000000000000000010-000000000${String(n)}`,
      }),
    );
    await s.commitEvents({ votes, deposits: [], cursor: { cursor: null, nextLedger: 11 } });
    const first = await s.listVotes(1, { limit: 2 });
    expect(first).toHaveLength(2);
    const rest = await s.listVotes(1, { limit: 2, afterEventId: first[1]?.eventId });
    expect(rest.map((v) => v.eventId)).toEqual(['0000000000000000010-0000000003']);
  });

  it('round-trips the cursor and records gaps', async () => {
    const s = memory();
    expect(await s.getCursor()).toBeUndefined();
    await s.commitEvents({ votes: [], deposits: [], cursor: { cursor: null, nextLedger: 50 } });
    expect(await s.getCursor()).toEqual({ cursor: null, nextLedger: 50 });
    await s.commitEvents({ votes: [], deposits: [], cursor: { cursor: 'abc', nextLedger: 60 } });
    expect(await s.getCursor()).toEqual({ cursor: 'abc', nextLedger: 60 });
    await s.recordGap({ fromLedger: 60, toLedger: 99, recordedAt: 123 });
    expect(await s.listGaps()).toEqual([{ fromLedger: 60, toLedger: 99, recordedAt: 123 }]);
  });
});
