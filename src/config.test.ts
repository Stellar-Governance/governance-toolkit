import { Networks } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { ConfigError } from './errors.js';

const base = {
  STELLAR_NETWORK: 'testnet',
  STELLAR_NETWORK_PASSPHRASE: Networks.TESTNET,
  STELLAR_RPC_URL: 'https://soroban-testnet.stellar.org',
  GOVERNANCE_CONTRACT_ID: 'CAOERDLG52UU6X5JENOXNKN4DWWJPVPNK7AD4RYXE3MA4TRBY62O5I5F',
  TOOLKIT_AUTH_DOMAIN: 'localhost',
};

describe('loadConfig', () => {
  it('accepts a minimal testnet configuration and fills defaults', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({
      network: 'testnet',
      port: 8787,
      host: '127.0.0.1',
      rpcTimeoutMs: 30_000,
      rpcRetries: 3,
      corsOrigins: [],
      startLedger: undefined,
    });
  });

  it('parses numbers and the CORS list', () => {
    const c = loadConfig({
      ...base,
      TOOLKIT_PORT: '9000',
      TOOLKIT_CORS_ORIGINS: 'http://localhost:3000, https://gov.example',
      TOOLKIT_START_LEDGER: '5611001',
    });
    expect(c.port).toBe(9000);
    expect(c.corsOrigins).toEqual(['http://localhost:3000', 'https://gov.example']);
    expect(c.startLedger).toBe(5_611_001);
  });

  it('treats empty values as unset, so a copied .env.example fails loudly', () => {
    expect(() => loadConfig({ ...base, GOVERNANCE_CONTRACT_ID: '' })).toThrow(ConfigError);
    expect(loadConfig({ ...base, TOOLKIT_PORT: '' }).port).toBe(8787);
  });

  it('rejects a passphrase that does not belong to the named network', () => {
    expect(() => loadConfig({ ...base, STELLAR_NETWORK_PASSPHRASE: Networks.PUBLIC })).toThrow(
      /does not match/,
    );
  });

  it('accepts an unknown network name with any passphrase (for example a local network)', () => {
    const c = loadConfig({
      ...base,
      STELLAR_NETWORK: 'local',
      STELLAR_NETWORK_PASSPHRASE: 'Standalone Network ; February 2017',
    });
    expect(c.network).toBe('local');
  });

  it('rejects invalid ids, URLs and ports', () => {
    expect(() => loadConfig({ ...base, GOVERNANCE_CONTRACT_ID: 'GABC' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, STELLAR_RPC_URL: 'not a url' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, TOOLKIT_PORT: '70000' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, TOOLKIT_CORS_ORIGINS: 'nope' })).toThrow(ConfigError);
    const withoutDomain: Record<string, string> = { ...base };
    delete withoutDomain.TOOLKIT_AUTH_DOMAIN;
    expect(() => loadConfig(withoutDomain)).toThrow(/TOOLKIT_AUTH_DOMAIN/);
  });
});
