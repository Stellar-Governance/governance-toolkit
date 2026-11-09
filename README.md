# governance-toolkit

Node service for Stellar Governance. It indexes the governance contract's proposals, votes and deposits from Stellar RPC, hosts proposal drafts and flat comments, signs people in with their Stellar wallet (SEP-53 signed message), and serves a JSON API for the voting frontend and the analytics site.

**Audit status:** neither this toolkit nor the governance contract it reads has been audited.

The toolkit never signs or sends transactions and holds no keys. Voting, deposits and proposals are made by people from their own wallets (in the frontend); the toolkit only reads the chain.

## Architecture

```
Stellar RPC ──► chain client (src/chain) ──► indexer (src/indexer) ──► SQLite store (src/store)
                 simulated reads + getEvents      every 15 s                     │
                                                                                 ▼
wallet ──SEP-53 signature──► sign-in (src/auth) ──► HTTP API (src/api, Fastify) ◄── frontend, analytics
                                  drafts + comments (src/discussion) ──┘
```

- **Proposals** are read with `proposal_count` and `get_proposal` (simulated calls; no fee). Contract state is not limited by RPC retention, so the proposal list and its tallies are complete. Proposals that can still change state are re-read on every run.
- **Votes and deposits per account** come from contract events (`vote_cast`, `deposited`, `withdrawn`), read with a stored cursor. RPC keeps events for a limited window (120,960 ledgers, about 7 days, on the public testnet RPC on 2026-11-07). If the toolkit was stopped for longer than that, the missing ledger range is recorded as a **gap** and reported by the API; it is not silently skipped.
- **Drafts** are Markdown texts. A draft's `contentHash` is the sha256 of its exact UTF-8 body: the value an author puts in the proposal's `description_hash`. When a published draft's hash equals an on-chain proposal's `description_hash`, the two are linked and the draft can no longer change.
- Contract bindings in `src/contract/` are generated from the deployed contract (see `src/contract/README.md`).

## Run against testnet

```bash
pnpm install --frozen-lockfile
pnpm build
cp .env.example .env    # then fill in the values below
pnpm start              # node --env-file-if-exists=.env dist/main.js
```

Example values for the project's testnet deployment (public data, no secrets):

```
STELLAR_NETWORK=testnet
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
GOVERNANCE_CONTRACT_ID=CAOERDLG52UU6X5JENOXNKN4DWWJPVPNK7AD4RYXE3MA4TRBY62O5I5F
TOOLKIT_START_LEDGER=5611001
TOOLKIT_AUTH_DOMAIN=localhost
TOOLKIT_CORS_ORIGINS=http://localhost:3000
```

Stop with Ctrl+C (SIGINT) or SIGTERM: the indexer finishes its current pass, then the listener and the database close. The shutdown sequence is tested through `stop()` in `src/service.test.ts`; delivering a real signal to the process has not been tested (the run below was on Windows, where the process was ended by its PID).

Checked on 2026-11-08: the built service (`pnpm start`) ran against the testnet deployment, indexed proposal 1 and its 7 events with no gap, and `/proposals`, `/proposals/1/votes`, `/accounts/<voter>` and `/stats/*` returned the same tallies, votes, transaction hashes and deposits as the chain.

## Environment variables

Empty values count as unset. Invalid values stop the service at start with `CONFIG_INVALID`.

| Variable                        | Required | Default                     | Meaning                                                                                           |
| ------------------------------- | -------- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| `STELLAR_NETWORK`               | yes      |                             | Network name. For `testnet`, `futurenet`, `mainnet`/`public` the passphrase is checked against it |
| `STELLAR_NETWORK_PASSPHRASE`    | yes      |                             | Network passphrase                                                                                |
| `STELLAR_RPC_URL`               | yes      |                             | Stellar RPC endpoint                                                                              |
| `GOVERNANCE_CONTRACT_ID`        | yes      |                             | Governance contract id (`C...`)                                                                   |
| `TOOLKIT_AUTH_DOMAIN`           | yes      |                             | Domain written into sign-in challenges (the site people sign in to)                               |
| `TOOLKIT_START_LEDGER`          | no       | oldest ledger the RPC has   | First ledger to read events from on the first run (the deploy ledger)                             |
| `TOOLKIT_DB_PATH`               | no       | `governance-toolkit.sqlite` | SQLite file                                                                                       |
| `TOOLKIT_HOST` / `TOOLKIT_PORT` | no       | `127.0.0.1` / `8787`        | HTTP listener                                                                                     |
| `TOOLKIT_CORS_ORIGINS`          | no       | none                        | Comma-separated browser origins allowed to call the API                                           |
| `TOOLKIT_CHALLENGE_TTL_SECS`    | no       | `300`                       | Sign-in challenge lifetime                                                                        |
| `TOOLKIT_SESSION_TTL_SECS`      | no       | `86400`                     | Session lifetime                                                                                  |
| `TOOLKIT_INDEX_INTERVAL_MS`     | no       | `15000`                     | Pause between indexer runs                                                                        |
| `TOOLKIT_RPC_TIMEOUT_MS`        | no       | `30000`                     | Timeout per RPC attempt                                                                           |
| `TOOLKIT_RPC_RETRIES`           | no       | `3`                         | Retries after a timeout, network error, HTTP 429 or 5xx (exponential backoff)                     |

## API

Full description: [`openapi.yaml`](openapi.yaml) (a test checks that it lists exactly the routes the server registers). This API serves the project's own frontend and analytics; it is not promised as a stable public API.

| Route                                                                   | Auth              | What                                                                                          |
| ----------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------- |
| `GET /health`                                                           |                   | Version, network, contract, indexer status (last success, last error, next ledger, gap count) |
| `GET /proposals?state=&proposer=&cursor=&limit=`                        |                   | Proposals, newest first                                                                       |
| `GET /proposals/:id`                                                    |                   | One proposal plus `texts`: published drafts whose hash equals its `description_hash`          |
| `GET /proposals/:id/votes?cursor=&limit=`                               |                   | Votes seen in events                                                                          |
| `GET /accounts/:address`                                                |                   | Latest deposit seen in events, and votes cast                                                 |
| `GET /stats/summary`, `/stats/proposals`, `/stats/votes`                |                   | Raw numbers for analytics, with `asOf` and `gaps`                                             |
| `POST /auth/challenge`, `POST /auth/verify`                             |                   | Sign-in (below)                                                                               |
| `GET /auth/session`, `POST /auth/logout`                                | Bearer            | Current session; sign out                                                                     |
| `GET /drafts/template`                                                  |                   | The built-in template                                                                         |
| `GET /drafts?author=&mine=true&cursor=&limit=`                          | Bearer for `mine` | Published drafts, or all of your own                                                          |
| `POST /drafts`, `PATCH /drafts/:id`                                     | Bearer            | Create; edit or publish (author only)                                                         |
| `GET /drafts/:id`                                                       | optional          | A published draft, or your own private one                                                    |
| `GET`/`POST /drafts/:id/comments`, `GET`/`POST /proposals/:id/comments` | Bearer to post    | Flat comments                                                                                 |
| `PATCH`/`DELETE /comments/:id`                                          | Bearer            | Edit or delete your own comment within 15 minutes                                             |

Conventions: amounts are decimal strings in the token's smallest unit (i128 does not fit a JSON number); times are seconds since the epoch; `limit` is 1 to 200 (default 50); a page's `next` is passed back as `cursor`. Errors are `{"error": {"code", "message"}}` with codes `VALIDATION` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `RATE_LIMITED` (429, with `Retry-After`), `INTERNAL` (500, no details).

Limits: draft title 120 UTF-8 bytes (the contract's title limit), draft body 32 KiB, comment 4,000 bytes, 5 comments per address per minute. Request bodies over 256 KiB are refused.

## Sign-in

1. `POST /auth/challenge {"address": "G..."}` returns a `message` naming the domain, the account, the network passphrase, a single-use nonce and an expiry (5 minutes).
2. The wallet signs `message` with SEP-53 (`signMessage` in the Stellar Wallets Kit): ed25519 over `SHA-256("Stellar Signed Message:\n" + message)`.
3. `POST /auth/verify {"address", "nonce", "signature"}` (signature as base64 or hex) returns `{"token", "address", "expiresAt"}`. Send the token as `Authorization: Bearer <token>`.

The nonce is used up by the first verify attempt, valid or not. The token is 32 random bytes; only its sha256 is stored. No cookies are set. Only `G...` accounts can sign in (contract accounts cannot sign messages). Tested with keys generated in tests, and on testnet with SEP-53 signatures made by the Stellar CLI (`stellar message sign`, used by `scripts/rehearse-draft.mjs`). Not yet tested with a browser wallet, so the signature encoding real wallets return is unverified.

## Data and privacy

Stored: proposals, votes, deposits and gaps read from the chain; drafts and comments with their author's address; sign-in challenges and hashed session ids. Not stored: IP addresses, e-mails, names, request logs. The service logs only indexer progress and unexpected errors.

## What this does not do

- **No event backfill beyond RPC retention.** A gap means per-voter votes and per-account deposits in that range are missing from `/proposals/:id/votes`, `/accounts/:address` and `/stats/votes`. Proposal tallies are unaffected. (Planned as Wave issue toolkit-5.)
- One process: the comment rate limiter is in memory, and SQLite is a local file.
- No threaded comments, proposal templates beyond one, draft export/import, or voting-intention signals (Wave issues toolkit-1 to toolkit-4).
- Proposal state in the API is as of the last indexer run (`checkedAt`), not live.

## Verify

```bash
pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Needs Node 24 and pnpm 11 (`corepack pnpm ...` if `pnpm` is not on PATH). Opt-in live tests read the testnet deployment: `LIVE_TESTNET=1 pnpm test` (read-only; nothing is signed or sent).

## License

MIT
