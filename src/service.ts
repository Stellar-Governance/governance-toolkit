import type { FastifyInstance } from 'fastify';
import { RateLimiter } from './api/rate-limit.js';
import { buildServer, type IndexerHealth } from './api/server.js';
import { AuthService } from './auth/service.js';
import { RpcChainClient, type ChainClient } from './chain/client.js';
import { HttpRpcTransport } from './chain/transport.js';
import type { ToolkitConfig } from './config.js';
import { CommentService } from './discussion/comments.js';
import { DraftService } from './discussion/drafts.js';
import { Indexer } from './indexer/indexer.js';
import { SqliteStore } from './store/sqlite.js';
import type { Store } from './store/types.js';
import { VERSION } from './version.js';

/** Parts a test may replace. */
export interface ServiceOverrides {
  chain?: ChainClient;
  store?: Store;
  /** Log sink; defaults to stdout with a timestamp. Never receives request IPs or secrets. */
  log?: (message: string) => void;
}

/** A running (or startable) toolkit service. */
export interface Service {
  app: FastifyInstance;
  health: IndexerHealth;
  /** Runs one indexing pass now (also used by the loop). */
  indexOnce(): Promise<void>;
  /** Starts the indexer loop and the HTTP listener; resolves to the listening address. */
  start(): Promise<string>;
  /** Stops the loop, waits for a running pass, closes the listener and the database. */
  stop(): Promise<void>;
}

/**
 * Wires configuration, store, chain client, indexer loop and HTTP API together.
 * @param config - validated settings (see `loadConfig`)
 * @param overrides - test doubles
 */
export function createService(config: ToolkitConfig, overrides: ServiceOverrides = {}): Service {
  const log =
    overrides.log ?? ((m: string) => process.stdout.write(`${new Date().toISOString()} ${m}\n`));
  const store = overrides.store ?? new SqliteStore(config.dbPath);
  const chain =
    overrides.chain ??
    new RpcChainClient({
      transport: new HttpRpcTransport({
        url: config.rpcUrl,
        timeoutMs: config.rpcTimeoutMs,
        retries: config.rpcRetries,
      }),
      contractId: config.contractId,
      networkPassphrase: config.networkPassphrase,
      rpcUrl: config.rpcUrl,
    });
  const indexer = new Indexer({ chain, store, startLedger: config.startLedger, log });
  const auth = new AuthService({
    store,
    domain: config.authDomain,
    networkPassphrase: config.networkPassphrase,
    challengeTtlSecs: config.challengeTtlSecs,
    sessionTtlSecs: config.sessionTtlSecs,
  });
  const drafts = new DraftService({ store });
  const comments = new CommentService({
    store,
    limiter: new RateLimiter({ limit: 5, windowSecs: 60 }),
  });
  const health: IndexerHealth = { lastSuccessAt: null, lastError: null };
  const app = buildServer({
    store,
    auth,
    drafts,
    comments,
    corsOrigins: config.corsOrigins,
    service: {
      version: VERSION,
      network: config.network,
      contractId: config.contractId,
      health: () => health,
    },
    logError: (message, error) => {
      log(`${message}: ${error instanceof Error ? error.message : String(error)}`);
    },
  });

  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  let stopped = false;

  async function indexOnce(): Promise<void> {
    try {
      const r = await indexer.runOnce();
      health.lastSuccessAt = Math.floor(Date.now() / 1000);
      health.lastError = null;
      if (r.newProposals > 0 || r.events > 0) {
        log(`indexed ${String(r.newProposals)} new proposals, ${String(r.events)} events`);
      }
      await store.purgeSessions(Math.floor(Date.now() / 1000));
      if (r.moreEvents) schedule(1_000);
    } catch (e) {
      health.lastError = e instanceof Error ? e.message : String(e);
      log(`indexer run failed: ${health.lastError}`);
    }
  }

  function schedule(delayMs: number): void {
    if (stopped) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (running !== undefined) return;
      running = indexOnce().finally(() => {
        running = undefined;
        schedule(config.indexIntervalMs);
      });
    }, delayMs);
  }

  return {
    app,
    health,
    indexOnce,
    async start() {
      const address = await app.listen({ host: config.host, port: config.port });
      log(`listening on ${address}; indexing ${config.contractId} on ${config.network}`);
      schedule(0);
      return address;
    },
    async stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      if (running !== undefined) await running;
      await app.close();
      await store.close();
      log('stopped');
    },
  };
}
