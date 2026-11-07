import { Networks, StrKey } from '@stellar/stellar-sdk';
import { z } from 'zod';
import { ConfigError } from './errors.js';

/** Passphrases of the public networks, used only to cross-check the configured pair. */
const KNOWN_PASSPHRASES: Readonly<Record<string, string>> = {
  testnet: Networks.TESTNET,
  futurenet: Networks.FUTURENET,
  mainnet: Networks.PUBLIC,
  public: Networks.PUBLIC,
};

const intFrom = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

const origins = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0),
  )
  .pipe(z.array(z.url()));

const schema = z.object({
  STELLAR_NETWORK: z.string().min(1),
  STELLAR_NETWORK_PASSPHRASE: z.string().min(1),
  STELLAR_RPC_URL: z.url(),
  GOVERNANCE_CONTRACT_ID: z
    .string()
    .refine((s) => StrKey.isValidContract(s), 'must be a contract id (C...)'),
  TOOLKIT_DB_PATH: z.string().min(1).default('governance-toolkit.sqlite'),
  TOOLKIT_HOST: z.string().min(1).default('127.0.0.1'),
  TOOLKIT_PORT: intFrom(1, 65_535).default(8787),
  TOOLKIT_CORS_ORIGINS: origins,
  TOOLKIT_AUTH_DOMAIN: z.string().min(1),
  TOOLKIT_CHALLENGE_TTL_SECS: intFrom(30, 3_600).default(300),
  TOOLKIT_SESSION_TTL_SECS: intFrom(60, 30 * 86_400).default(86_400),
  TOOLKIT_INDEX_INTERVAL_MS: intFrom(1_000, 3_600_000).default(15_000),
  TOOLKIT_RPC_TIMEOUT_MS: intFrom(1_000, 120_000).default(30_000),
  TOOLKIT_RPC_RETRIES: intFrom(0, 10).default(3),
  TOOLKIT_START_LEDGER: intFrom(1, 2 ** 32 - 1).optional(),
});

/** Validated toolkit settings. */
export interface ToolkitConfig {
  network: string;
  networkPassphrase: string;
  rpcUrl: string;
  contractId: string;
  dbPath: string;
  host: string;
  port: number;
  corsOrigins: string[];
  authDomain: string;
  challengeTtlSecs: number;
  sessionTtlSecs: number;
  indexIntervalMs: number;
  rpcTimeoutMs: number;
  rpcRetries: number;
  /** First ledger to read events from when there is no stored cursor (for example the deploy ledger). */
  startLedger: number | undefined;
}

/**
 * Reads and validates the toolkit settings from environment variables.
 * Empty strings count as unset, so a copied `.env.example` fails loudly instead of half-working.
 * @param env - the environment, normally `process.env`
 * @returns the validated settings
 * @throws {ConfigError} when a value is missing or invalid, or when the network name and
 *   passphrase do not belong together
 */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): ToolkitConfig {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && v.trim() !== '') cleaned[k] = v.trim();
  }
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new ConfigError(`invalid configuration: ${detail}`);
  }
  const c = parsed.data;
  const network = c.STELLAR_NETWORK.toLowerCase();
  const expected = KNOWN_PASSPHRASES[network];
  if (expected !== undefined && expected !== c.STELLAR_NETWORK_PASSPHRASE) {
    throw new ConfigError(
      `STELLAR_NETWORK_PASSPHRASE does not match STELLAR_NETWORK=${c.STELLAR_NETWORK}`,
    );
  }
  return {
    network,
    networkPassphrase: c.STELLAR_NETWORK_PASSPHRASE,
    rpcUrl: c.STELLAR_RPC_URL,
    contractId: c.GOVERNANCE_CONTRACT_ID,
    dbPath: c.TOOLKIT_DB_PATH,
    host: c.TOOLKIT_HOST,
    port: c.TOOLKIT_PORT,
    corsOrigins: c.TOOLKIT_CORS_ORIGINS,
    authDomain: c.TOOLKIT_AUTH_DOMAIN,
    challengeTtlSecs: c.TOOLKIT_CHALLENGE_TTL_SECS,
    sessionTtlSecs: c.TOOLKIT_SESSION_TTL_SECS,
    indexIntervalMs: c.TOOLKIT_INDEX_INTERVAL_MS,
    rpcTimeoutMs: c.TOOLKIT_RPC_TIMEOUT_MS,
    rpcRetries: c.TOOLKIT_RPC_RETRIES,
    startLedger: c.TOOLKIT_START_LEDGER,
  };
}
