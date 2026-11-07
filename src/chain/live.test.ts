/**
 * Read-only checks against the real testnet deployment. Opt-in: `LIVE_TESTNET=1 pnpm test`.
 * They read state and events; they never sign or send anything.
 */
import { Networks } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { ContractCallError } from '../errors.js';
import { RpcChainClient } from './client.js';
import { HttpRpcTransport } from './transport.js';

const live = process.env.LIVE_TESTNET === '1';
const CONTRACT_ID =
  process.env.GOVERNANCE_CONTRACT_ID ?? 'CAOERDLG52UU6X5JENOXNKN4DWWJPVPNK7AD4RYXE3MA4TRBY62O5I5F';
const RPC_URL = process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';
/** Ledger the contract was deployed in (docs/TESTNET.md); events start after it. */
const DEPLOY_LEDGER = Number(process.env.TOOLKIT_START_LEDGER ?? '5611001');

function client(): RpcChainClient {
  return new RpcChainClient({
    transport: new HttpRpcTransport({ url: RPC_URL, timeoutMs: 30_000, retries: 3 }),
    rpcUrl: RPC_URL,
    contractId: CONTRACT_ID,
    networkPassphrase: Networks.TESTNET,
  });
}

describe.runIf(live)('live testnet (read-only)', () => {
  it('reads the latest ledger with the ledger close time', async () => {
    const l = await client().latestLedger();
    expect(l.sequence).toBeGreaterThan(DEPLOY_LEDGER);
    expect(l.closeTime).toBeGreaterThan(1_700_000_000);
  });

  it('reads config, proposal 1 and its votes', async () => {
    const c = client();
    const config = await c.config();
    expect(config.quorumBps).toBeGreaterThan(0);
    expect(await c.proposalCount()).toBeGreaterThanOrEqual(1n);
    const p = await c.proposal(1n);
    expect(p.title.length).toBeGreaterThan(0);
    expect(p.descriptionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof (await c.proposalState(1n))).toBe('string');
    const vote = await c.vote(1n, p.proposer);
    expect(vote === null || vote.power > 0n).toBe(true);
    expect(await c.depositOf(p.proposer)).toBeGreaterThanOrEqual(0n);
  }, 60_000);

  it('maps an unknown proposal to ProposalNotFound', async () => {
    const err = await client()
      .proposal(9_999_999n)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ContractCallError);
    expect((err as ContractCallError).contractError).toBe('ProposalNotFound');
  }, 60_000);

  it('reads and decodes events, or reports the retention window', async () => {
    const c = client();
    const r = await c.retention();
    const start = Math.max(DEPLOY_LEDGER, r.oldestLedger);
    const page = await c.events({ startLedger: start }, 100);
    expect(page.cursor.length).toBeGreaterThan(0);
    for (const e of page.events) expect(e.txHash).toMatch(/^[0-9a-f]{64}$/);
  }, 60_000);
});
