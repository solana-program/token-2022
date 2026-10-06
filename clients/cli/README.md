# SPL Token program command-line utility

A basic command-line for creating and using SPL Tokens.  See the
[Solana Program Docs](https://www.solana-program.com/docs/token) for more info.

## Build

To build the CLI locally, simply run:

```sh
cargo build
```

## Offline confidential transactions

Confidential operations on existing mints support `--sign-only` without RPC access. Supply the
Token-2022 program with `--program-2022` or
`--program-id TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`, a previously obtained
`--blockhash`, and the account information below. Signing constructs transactions
and generates proofs locally; it does not submit transactions, confirm them, or
change accounts. Online commands retain their existing behavior. Mint creation
retains the CLI's existing online-only behavior.

Ciphertexts and ElGamal public keys use their existing base64 encodings. Provide
the actual encrypted balances and counters from the same current account snapshot.
Subsequent account changes can invalidate proofs or leave a pending-balance
application's decryptable cache out of sync. Amounts must be explicit: `ALL`
requires online account information.

| Command | Additional offline information |
| --- | --- |
| `configure-confidential-transfer-account` | `--reallocate` or `--account-is-preallocated`; add `--confidential-transfer-fee` with `--reallocate` when the mint has confidential transfer fees. Registry configuration with `--elgamal-registry` needs neither allocation flag. |
| `approve-confidential-transfer-account`; enable/disable confidential or non-confidential credits | Mint address when selecting an account with `--address`. |
| `empty-confidential-transfer-account` | `--available-balance`. |
| `deposit-confidential-tokens` | `--mint-decimals`. |
| `withdraw-confidential-tokens` | `--mint-decimals`, `--available-balance`, `--decryptable-available-balance`, `--proof-account-lamports`. |
| `apply-pending-balance` | `--pending-balance-lo`, `--pending-balance-hi`, `--pending-balance-credit-counter`, `--available-balance`, `--decryptable-available-balance`. |
| `transfer --confidential` | `--mint-decimals`, `--available-balance`, `--decryptable-available-balance`, `--recipient-elgamal-pubkey`, `--auditor-pubkey`, `--proof-account-lamports`. With `--expected-fee`, also supply `--transfer-fee-basis-points`, `--transfer-fee-maximum-fee` in base units, `--withdraw-withheld-authority-elgamal-pubkey`, and `--with-compute-unit-limit` sufficient for the U256 range proof, for example `500000`. The default compute budget is too small for that proof. |
| `mint --confidential` | `--mint-decimals`, `--confidential-supply`, `--decryptable-supply`, `--recipient-elgamal-pubkey`, `--auditor-pubkey`, `--proof-account-lamports`. |
| `burn --confidential` | `--mint-address`, `--mint-decimals`, `--available-balance`, `--decryptable-available-balance`, `--supply-elgamal-pubkey`, `--auditor-pubkey`, `--proof-account-lamports`. |
| `withdraw-withheld-tokens --confidential` | `--mint-address`, `--recipient-elgamal-pubkey`, `--available-balance`, `--decryptable-available-balance`, and one `--withheld-amount` per withdrawal: mint first when included, then source accounts sorted by public-key bytes and deduplicated, in batches of at most eight. Each amount is the batch's aggregate ciphertext. |
| `update-confidential-transfer-settings` | Both `--approve-policy` and `--auditor-pubkey`. |
| `apply-pending-burn`, `update-decryptable-supply`, confidential fee harvesting and harvesting toggles | Existing command inputs suffice. |

For account commands that accept a mint or `--address`, supply `--mint-address`
when using `--address` without the positional mint. Use `--auditor-pubkey none`
when the mint has no auditor. Offline transfers treat the recipient as a token
account by default, matching `--no-recipient-is-ata-owner`. The existing
`--recipient-is-ata-owner` flag (deprecated) derives the associated token account
from a recipient owner instead.

Offline balance application and fee withdrawal verify that the decryptable balance
matches the supplied `--available-balance` ciphertext before updating it. If the
decryptable cache is uninitialized, the available ciphertext must be all-zero before
the command can initialize the cache to an encrypted zero balance. Fee withdrawal
also verifies that `--recipient-elgamal-pubkey` matches the key derived from `--owner`.

`--proof-account-lamports` specifies funding for **each** temporary proof context
and record account. Obtain the required rent beforehand and provide enough for
the largest account in the operation, including its proof record. The offline
command does not estimate rent or check the fee payer's funds.

Commands that derive encryption keys require the actual signing owner or mint
authority through the existing local or hardware signer support. A public key or
presupplied transaction signature cannot derive those keys. Confidential fee
withdrawal requires signing keys for both the withdraw authority and recipient
owner. Custom encryption keys and multisig key derivation are unsupported.
The fee payer can be a public key for partial signing; the output retains all
available signatures, including temporary proof-account signatures.

For example, after setting these variables to the real mint/account state and
chosen proof-account funding, a withdrawal can be generated against an
unreachable endpoint:

```sh
spl-token --program-2022 --url http://127.0.0.1:1 \
  --fee-payer "$FEE_PAYER_PUBKEY" --output json-compact \
  withdraw-confidential-tokens "$MINT_ADDRESS" "$WITHDRAW_AMOUNT" \
  --owner "$OWNER_KEYPAIR_PATH" --address "$TOKEN_ACCOUNT_ADDRESS" \
  --mint-decimals "$MINT_DECIMALS" --blockhash "$BLOCKHASH" --sign-only \
  --available-balance "$AVAILABLE_BALANCE_BASE64" \
  --decryptable-available-balance "$DECRYPTABLE_AVAILABLE_BALANCE_BASE64" \
  --proof-account-lamports "$PROOF_ACCOUNT_LAMPORTS" \
  --dump-transaction-message
```

Single-transaction output uses the existing sign-only format; add
`--dump-transaction-message` to retain its message for later submission. Multi-transaction
output reports an executable order, including setup, every proof write, the
operation, and cleanup. Both JSON formats return one document with a
`transactions` array in that order. Each entry contains `transaction` (its label)
and the existing `blockhash`, `signers`, `absent`, and `badSig` sign-only fields.
Every entry also includes its base64 `message`, even without
`--dump-transaction-message`.
Keep these messages and signatures, add the missing signatures using existing
Solana transaction tooling, and submit those exact transactions in the reported
order before the blockhash expires. Do not regenerate the command to finish
signing: new temporary accounts and proofs would produce different messages.

Existing durable nonce arguments work for single-transaction commands. A single
nonce cannot execute multiple dependent transactions, so workflows producing
multiple transactions reject that combination.

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
