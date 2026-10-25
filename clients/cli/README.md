# SPL Token program command-line utility

A basic command-line for creating and using SPL Tokens.  See the
[Solana Program Docs](https://www.solana-program.com/docs/token) for more info.

## Build

To build the CLI locally, simply run:

```sh
cargo build
```

## Offline confidential transactions

These commands support `--sign-only` without RPC access on existing Token-2022 mints:

- `approve-confidential-transfer-account`
- `enable-confidential-credits`, `disable-confidential-credits`,
  `enable-non-confidential-credits`, `disable-non-confidential-credits`
- `deposit-confidential-tokens`
- `harvest-withheld-confidential-tokens`
- `enable-confidential-fee-harvesting`, `disable-confidential-fee-harvesting`
- `update-confidential-transfer-settings`
- `apply-pending-burn`

Use `--program-2022` or the Token-2022 `--program-id`, and supply a previously
obtained `--blockhash`. Deposits require `--mint-decimals` and an explicit amount;
`ALL` needs online account information. Approval and credit commands need
`--mint-address` when selecting an account with `--address` instead of a positional
mint. Settings updates require both `--approve-policy` and `--auditor-pubkey`;
use `--auditor-pubkey none` when auditing is disabled.

Offline harvesting accepts at most 25 distinct source accounts. Harvesting with
a durable nonce accepts at most 23 sources, both online and offline. Sources are
sorted and deduplicated before construction. Split larger sets into separate
invocations, using the updated nonce hash after each submission. Online harvesting
without a nonce continues to batch larger sets automatically.
Each command produces one transaction in the existing sign-only format and
supports the existing durable nonce arguments. Commands that generate new proofs
or ciphertexts are outside this workflow.

For online completion of offline signatures, use a durable nonce. Without a
nonce, the online CLI fetches the latest blockhash even when `--blockhash` is
supplied, so it cannot reliably reuse signatures from an earlier blockhash.
Non-nonce `--sign-only` invocations can still reproduce the same offline message
with the same inputs.

For example, obtain a nonce account's current hash beforehand, with the owner as
its nonce authority. The owner signs a deposit on an offline machine. The fee
payer can be a public key, so its signature remains absent. `--sign-only` does not
contact the RPC endpoint:

```sh
spl-token --program-2022 \
  --fee-payer "$FEE_PAYER_PUBKEY" --output json-compact \
  deposit-confidential-tokens "$MINT_ADDRESS" 10 \
  --owner "$OWNER_KEYPAIR_PATH" --mint-decimals "$MINT_DECIMALS" \
  --nonce "$NONCE_ACCOUNT" --nonce-authority "$OWNER_KEYPAIR_PATH" \
  --blockhash "$NONCE_HASH" --sign-only
```

Set `$OWNER_SIGNER` to the owner's full `PUBKEY=SIGNATURE` entry from `signers`.
On an online machine, repeat the command using the owner's public key and its
signature, provide the fee payer's keypair, and omit `--sign-only`:

```sh
spl-token --program-2022 --url "$RPC_URL" \
  --fee-payer "$FEE_PAYER_KEYPAIR_PATH" \
  deposit-confidential-tokens "$MINT_ADDRESS" 10 \
  --owner "$OWNER_PUBKEY" --signer "$OWNER_SIGNER" \
  --mint-decimals "$MINT_DECIMALS" --blockhash "$NONCE_HASH" \
  --nonce "$NONCE_ACCOUNT" --nonce-authority "$OWNER_PUBKEY"
```

Keep the amount, account addresses, decimals, nonce hash, and compute budget
identical when completing signing. For approval or credit commands selected
with `--address`, retain `--mint-address` during online submission; the CLI verifies
it against that account's mint. `--dump-transaction-message` is optional.
A separate nonce authority follows the same keypair or public key plus
`--signer PUBKEY=SIGNATURE` workflow. The nonce must remain unchanged until
submission; fetch its new hash before the next invocation.

## Testing

The tests require locally built Token-2022 and ElGamal registry programs. To build
them, run the following commands from the root directory of this repository:

```sh
cargo build-sbf --manifest-path program/Cargo.toml
cargo build-sbf --manifest-path confidential/elgamal-registry/Cargo.toml
```

After that, you can run the tests as any other Rust project:

```sh
cargo test
```
