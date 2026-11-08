# Contributing to governance-toolkit

Thank you for helping with the governance toolkit (indexer, drafts, discussion, sign-in, read API). This is an early, unaudited project; small, well-tested changes are the easiest to review.

## Set up

- Node 24 and pnpm 11 (`corepack enable`, or run `corepack pnpm ...`).

Then, in this folder:

```bash
pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

That is the whole check. A pull request is ready when it passes.

## Rules for this package

- TypeScript strict mode, no `any`. Validate every external input (HTTP, environment, RPC) with zod.
- Throw `ToolkitError` subclasses with a stable code; never send internal details in an API error.
- Store no personal data: no IP addresses, e-mails or names. Never log session tokens.
- Keep `openapi.yaml` in step with the routes (a test checks it).
- Every public function has JSDoc, a test for success and at least one for failure.
- Testnet only. Never put secret keys, seed phrases or tokens in code, tests, logs or issues.
- Documentation describes what exists and is tested; no aspirational claims.

## Commits and pull requests

- Conventional Commits: `feat: ...`, `fix: ...`, `docs: ...`, `test: ...`, `chore: ...`.
- One topic per pull request. Fill in the pull request template, including how you tested.
- Code marked `WAVE-ISSUE(<id>)` is where a planned issue plugs in; keep the marker until that issue is done.

## Claiming an issue

Comment on the issue that you would like to work on it and wait for a maintainer to assign it before starting. If you stop, say so, so someone else can take it. Issues labelled with a complexity (Trivial, Medium, High) describe their acceptance criteria; meet all of them.
