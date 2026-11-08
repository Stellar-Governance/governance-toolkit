import { readFileSync } from 'node:fs';
import { Networks } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { RpcTimeoutError } from './errors.js';
import { createService } from './service.js';
import { SqliteStore } from './store/sqlite.js';
import { FakeChain, sampleProposal } from './testing/fake-chain.js';
import { VERSION } from './version.js';

const config = loadConfig({
  STELLAR_NETWORK: 'testnet',
  STELLAR_NETWORK_PASSPHRASE: Networks.TESTNET,
  STELLAR_RPC_URL: 'https://rpc.invalid',
  GOVERNANCE_CONTRACT_ID: 'CAOERDLG52UU6X5JENOXNKN4DWWJPVPNK7AD4RYXE3MA4TRBY62O5I5F',
  TOOLKIT_AUTH_DOMAIN: 'localhost',
  TOOLKIT_HOST: '127.0.0.1',
  TOOLKIT_PORT: '1',
  TOOLKIT_INDEX_INTERVAL_MS: '60000',
  TOOLKIT_START_LEDGER: '1',
});

describe('createService', () => {
  it('serves indexed chain state over real HTTP and stops cleanly', async () => {
    const chain = new FakeChain();
    chain.proposals.push({ proposal: sampleProposal({ title: 'Live' }), state: 'Active' });
    const logs: string[] = [];
    const service = createService(
      { ...config, port: 0 },
      { chain, store: new SqliteStore(':memory:'), log: (m) => logs.push(m) },
    );
    const address = await service.start();
    try {
      await service.indexOnce();
      const health = (await (await fetch(`${address}/health`)).json()) as {
        version: string;
        indexer: { lastSuccessAt: number | null };
      };
      expect(health.version).toBe(VERSION);
      expect(health.indexer.lastSuccessAt).not.toBeNull();
      const list = (await (await fetch(`${address}/proposals`)).json()) as {
        items: { title: string }[];
      };
      expect(list.items.map((p) => p.title)).toEqual(['Live']);
    } finally {
      await service.stop();
    }
    await expect(fetch(`${address}/health`)).rejects.toThrow();
    expect(logs.some((l) => l.startsWith('listening on'))).toBe(true);
    expect(logs.at(-1)).toBe('stopped');
  });

  it('reports a failed indexer run in /health and keeps serving', async () => {
    const chain = new FakeChain();
    chain.latestLedger = () => Promise.reject(new RpcTimeoutError('getLatestLedger', 30_000));
    const service = createService(
      { ...config, port: 0 },
      { chain, store: new SqliteStore(':memory:'), log: () => undefined },
    );
    await service.indexOnce();
    const res = await service.app.inject({ method: 'GET', url: '/health' });
    expect(res.json<{ indexer: { lastError: string } }>().indexer.lastError).toMatch(/timed out/);
    await service.stop();
  });
});

describe('VERSION', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
  });
});
