# Generated contract bindings

`index.ts`, `client.ts` and `types.ts` are generated from the deployed governance contract. Do not edit them by hand.

| | |
|---|---|
| Contract | `CAOERDLG52UU6X5JENOXNKN4DWWJPVPNK7AD4RYXE3MA4TRBY62O5I5F` (testnet) |
| Wasm sha256 | `b08f42668fb100075b215766c5b3a278d5888fbfab57cb2c8b358fc57b1b30ef` |
| Generator | `@stellar/stellar-sdk` 17.4.0, `stellar-js generate` |
| Generated | 2026-11-07 |

Regenerate (from the package folder; the generator writes a whole package, of which only `src/*.ts` is kept):

```bash
pnpm exec stellar-js generate --contract-id <CONTRACT_ID> --network testnet --timeout 30000 \
  --contract-name governance-contract --output-dir <scratch dir>
# then copy <scratch dir>/src/{index,client,types}.ts here and put the 5-line header back on each
```

The generated `package.json`, `tsconfig.json`, `README.md` and `.gitignore` are not kept. Its `buffer` dependency is not needed: the generated sources do not use `Buffer`.

Edits made after generation: only the header comment (source, hash, generator, `eslint-disable`). Lint and Prettier skip this folder; `tsc` type-checks it under the package's strict settings without changes.

`../bindings.test.ts` checks that the bindings still list every contract function and keep the enum values and error codes.

How contract types appear:
- `Vec<Val>` (the `args` of an `Invoke` call) is `Array<any>`, so the types do not say how each argument must be encoded. The toolkit only reads `Invoke` actions; building one is done by the contract package's release script (PLAYBOOK task 5.1), which records the working encoding.
- Tuple enum variants are tagged objects: `{ tag: "UpdateConfig", values: [Config] }`, `{ tag: "Invoke", values: [Call] }`.
- `VoteChoice` and `ProposalState` are TypeScript numeric enums (the contract gives them explicit discriminants).
- `u64` and `i128` are `bigint`; `u32` is `number`; `BytesN<32>` is `Uint8Array`; `Address` is a `G...`/`C...` string.
- Contract errors are the `Error` map in `types.ts`, keyed by code, with the variant name as `message`.
- Events: `Client.parseEvent(topics, data)` decodes an event, and `<name>EventFilter()` builds a `getEvents` topic filter.
