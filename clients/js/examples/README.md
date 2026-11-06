# JavaScript examples

## Create a mint with metadata

`createMintWithMetadata.mjs` creates a Token-2022 mint with its metadata stored
on the mint account. `MetadataPointer` points to that account, and `TokenMetadata`
holds the name, symbol, URI, and update authority. The example then fetches and
prints the mint, including both extensions.

Use Node.js 24 or newer, pnpm, and the Solana CLI. Start a local validator in a
separate terminal:

```sh
solana-test-validator
```

From `clients/js`, install dependencies, build the client, and run the example:

```sh
pnpm install
pnpm build
node examples/createMintWithMetadata.mjs
```

The example connects only to the local validator, requests test SOL, and uses a
new in-memory authority on each run. Its keys are not saved. The metadata URI is
a placeholder; no metadata file is uploaded. This creates a mint with zero
supply, not token accounts or issued tokens.
