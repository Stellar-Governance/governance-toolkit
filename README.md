# governance-toolkit

Node service for Stellar Governance. It will index on-chain proposals and votes, host proposal drafts and discussion, sign people in with their Stellar wallet, and serve a read API for the frontend and analytics.

**Status:** skeleton only. The service is built in Phase 2 (see the project `PLAYBOOK.md`).

**Audit status:** the governance contract this toolkit reads has not been audited, and neither has this toolkit.

## Verify

```bash
pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Needs Node 24 and pnpm 11 (`corepack pnpm ...` if `pnpm` is not on PATH).

## License

MIT
