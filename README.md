# governance-toolkit

Node service for Stellar Governance. It will index on-chain proposals and votes, host proposal drafts and discussion, sign people in with their Stellar wallet, and serve a read API for the frontend and analytics.

**Status:** in progress. Built so far: validated configuration (`src/config.ts`, see `.env.example`), typed errors, a read-only chain client over Stellar RPC with timeouts and retries (`src/chain/`) using contract bindings generated into `src/contract/`, a SQLite store (`src/store/`, Node's built-in `node:sqlite`), the indexer (`src/indexer/`, which records event ranges lost to RPC retention as gaps), and wallet sign-in with a SEP-53 signed challenge (`src/auth/`, routes under `/auth`). Drafts, comments and the read API are not built yet.

Opt-in live tests read the testnet deployment: `LIVE_TESTNET=1 pnpm test` (read-only; nothing is signed or sent).

**Audit status:** the governance contract this toolkit reads has not been audited, and neither has this toolkit.

## Verify

```bash
pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Needs Node 24 and pnpm 11 (`corepack pnpm ...` if `pnpm` is not on PATH).

## License

MIT
