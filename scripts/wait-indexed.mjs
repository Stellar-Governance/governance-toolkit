#!/usr/bin/env node
// Checks the toolkit's health and optionally waits until a proposal is indexed in a given state.
//   node scripts/wait-indexed.mjs [--url http://127.0.0.1:8787] [--proposal 2 --state Executed]
//                                 [--timeout 600]
// Exits 0 when the condition holds, 1 on timeout or an unhealthy toolkit.

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const url = opt('url', 'http://127.0.0.1:8787').replace(/\/+$/, '');
const proposal = opt('proposal', undefined);
const state = opt('state', undefined);
const timeoutSecs = Number(opt('timeout', '600'));
const deadline = Date.now() + timeoutSecs * 1000;

async function getJson(path) {
  const res = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${path} answered ${String(res.status)}`);
  return res.json();
}

async function main() {
  let last = '';
  while (Date.now() < deadline) {
    try {
      const health = await getJson('/health');
      if (health.indexer.lastError !== null) last = `indexer error: ${health.indexer.lastError}`;
      else if (health.indexer.lastSuccessAt === null) last = 'indexer has not finished a run yet';
      else if (proposal === undefined) {
        console.log(
          `healthy: next ledger ${String(health.indexer.nextLedger)}, gaps ${String(health.indexer.gaps)}`,
        );
        return 0;
      } else {
        const p = await getJson(`/proposals/${proposal}`);
        if (state === undefined || p.state === state) {
          console.log(
            `proposal ${proposal}: ${p.state} (for ${p.forVotes}, against ${p.againstVotes}, abstain ${p.abstainVotes})`,
          );
          return 0;
        }
        last = `proposal ${proposal} is ${p.state}, waiting for ${state}`;
      }
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  console.error(`timed out after ${String(timeoutSecs)} s: ${last}`);
  return 1;
}

process.exit(await main());
