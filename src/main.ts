/**
 * Service entry point: `node --env-file-if-exists=.env dist/main.js` (the `start` script).
 * Reads settings from the environment, starts the indexer loop and the HTTP API, and shuts
 * down cleanly on SIGINT or SIGTERM.
 */
import { loadConfig } from './config.js';
import { ToolkitError } from './errors.js';
import { createService } from './service.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const service = createService(config);
  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    process.stdout.write(`received ${signal}, shutting down\n`);
    service.stop().then(
      () => process.exit(0),
      (e: unknown) => {
        process.stderr.write(`shutdown failed: ${e instanceof Error ? e.message : String(e)}\n`);
        process.exit(1);
      },
    );
  };
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  await service.start();
}

main().catch((e: unknown) => {
  const message = e instanceof ToolkitError ? `${e.code}: ${e.message}` : String(e);
  process.stderr.write(`governance-toolkit failed to start: ${message}\n`);
  process.exit(1);
});
