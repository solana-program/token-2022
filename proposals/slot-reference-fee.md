# SlotReferenceFee: a Token-2022 mint extension

Status: implemented in this branch (interface, program, client, integration tests).
Author: Jarett Dunn (@staccDOTsol).

## Summary

`SlotReferenceFee` is a mint extension that keeps one global, per-mint, per-slot reference
counter in the mint account and charges an in-kind fee of `floor_basis_points * n²` on the
n-th `TransferChecked` of the mint in the current slot, capped, with the first
`free_references` references in a slot free. Fees are withheld on the destination account
the way `TransferFee` withholds them, harvested to the mint permissionlessly, and withdrawn
permissionlessly to two fixed places: a sink token account owned by the incinerator
address, and a `fee_destination` token account chosen at initialization. Nothing is
burned, and nothing reaches whoever initiated the transfer.

Because Token-2022 is the program that executes every transfer of every mint that carries
the extension, this is enforced on every DEX, every AMM, every terminal and every bundle,
whether or not they know about it. There is no venue to route around. The one visible
change for integrators is that the mint must be passed as writable in every transfer.

## The problem it prices

arXiv:2609.28115 counts 28.0 million sandwiches against protected order flow on Solana
over three years and finds that after the validator leak was closed in 2025 the victims
concentrate around a few pump.fun trading terminals. That is the ordering-dependent shape
of extraction. There is a second shape that needs no ordering and no mempool at all, and
it was run against a launch on Robinhood Chain on 2026-09-26 within thirty-two minutes:
fifty-nine permissionless pools on the token, fee tiers of 70 to 98 percent, a price
ladder walked seventeen times higher by initializing pool after pool at rising quotes with
no tokens deposited, liquidity added and pulled inside the same block, a fixed toll on
every fill, one operator touching 532 tokens in a month with a net position per token of
roughly zero. The same machine is reproduced on Solana, on purpose and visibly, in
`staccDOTsol/the-book`: nine Orca pools under one config, eight of them quoting 5x to
5000x with no liquidity, legs in Jito bundles, creator fees swept every cycle.

Every step of that machine is the same primitive: reference the same mint many times in
the same slot. A single-leader ordering rule, a batch auction, private submission and
encrypted mempools do not touch it, because it is not reacting to any transaction. It is
reacting to the existence of the mint.

None of this is a judgement on memecoins. A mint is a mint; a launch is a market; the
program does not care what is being launched. What the extension prices is a practice:
the same machine run against every launch on the network, because repetition is free.

## Why in the token program and not a transfer hook

A transfer hook can reject a transfer and can keep its own counters in program-derived
accounts, but it cannot take a fee from the transfer without extra accounts and a
delegate, and it runs after the fact. Inside `process_transfer` the counter is a few
fields in the mint's TLV data and the fee is computed exactly where `TransferFee`
computes its fee. The extension costs about what `TransferFee` costs and needs no extra
accounts: the mint and the Clock syscall are already in reach of every `TransferChecked`.

## What is enforced

| rule | mechanism |
|---|---|
| n-th transfer of the mint in a slot pays `floor * n²` bp, capped | `SlotReferenceFeeConfig::reference` and `calculate_fee` in `process_transfer` |
| first `free_references` transfers in a slot are free | `fee_basis_points` returns 0 for `n <= free_references` |
| the count is global per mint, not per signer | the counter lives in the mint account |
| a new slot resets the count | `reference` compares `Clock::get().slot` to the stored slot |
| fees are withheld on the destination, never on the sender | `SlotReferenceFeeAmount.withheld_amount`, like `TransferFeeAmount` |
| accounts with withheld fees cannot be closed | `closable` check in `process_close_account` |
| harvest is permissionless | `HarvestWithheldTokensToMint` takes any accounts of the mint |
| withdrawal is permissionless and goes only to the sink and `fee_destination` | `WithdrawWithheldTokensFromMint` checks the sink's owner is the incinerator and the destination equals the configured one |
| nothing is burned | no supply change anywhere in the extension |
| the mint must be writable in transfers | `SlotReferenceFeeMintNotWritable` if it is not |
| every token account of the mint carries the account extension | `required_init_account_extensions` |
| cannot combine with confidential transfers | `check_for_invalid_mint_extension_combinations`: the fee needs to see amounts |
| schedule can be changed only by the authority, and the authority can be revoked | `Set`, `AuthorityType::SlotReferenceFee` |
| the sink share is immutable | not present in `Set` |

## State

### Mint extension `SlotReferenceFeeConfig`

```rust
#[repr(C)]
pub struct SlotReferenceFeeConfig {
    /// Optional authority to update the fee schedule and the fee destination.
    /// None makes the configuration immutable.
    pub authority: MaybeNull<Address>,
    /// Token account of this mint that receives the non-sink share of every withdrawal.
    pub fee_destination: Address,
    /// Fee for the n-th reference in a slot is floor * n * n basis points.
    pub floor_basis_points: U16,
    /// Hard cap on the fee, in basis points (at most 10,000).
    pub cap_basis_points: U16,
    /// References per slot that carry no fee.
    pub free_references: U16,
    /// Share of every withdrawal that goes to the sink, in basis points. Immutable.
    pub sink_share_basis_points: U16,
    /// Slot the counter belongs to. Reset whenever the clock moves past it.
    pub slot: U64,
    /// References to this mint in `slot` so far.
    pub count: U64,
    /// Withheld fees harvested to the mint and not yet withdrawn.
    pub withheld_amount: U64,
}
```

`ExtensionType::SlotReferenceFeeConfig`, a mint extension. Fixed size, 96 bytes of data.

### Account extension `SlotReferenceFeeAmount`

```rust
#[repr(C)]
pub struct SlotReferenceFeeAmount {
    /// Amount withheld during transfers, to be harvested to the mint
    pub withheld_amount: U64,
}
```

`ExtensionType::SlotReferenceFeeAmount`, required on every token account of a mint that
carries the config, exactly like `TransferFeeAmount`.

### The sink

Any token account of the mint whose owner is the incinerator address
(`slot_reference_fee::sink_owner()`, i.e. `1nc1nerator11111111111111111111111111111111`).
Nobody holds that key, so no transfer, approval or close can ever be signed for it. The
associated token account of the incinerator is the natural sink and anyone can create it.
The program never moves tokens out of a sink; it only credits it. A sink is the in-kind
counterpart of the perpetual stake on the Ethereum side of this design: it belongs to
nobody and it only grows.

## Instructions

All under `TokenInstruction::SlotReferenceFeeExtension` (discriminant 47), with a second
byte selecting the sub-instruction, the same layout every extension uses.

| # | instruction | accounts | data |
|---|---|---|---|
| 0 | `Initialize` | `[w] mint` | `InitializeInstructionData { authority: MaybeNull<Address>, fee_destination: Address, floor_basis_points, cap_basis_points, free_references, sink_share_basis_points }` |
| 1 | `Set` | `[w] mint`, `[s] authority` (or multisig + signers) | `SetInstructionData { fee_destination, floor_basis_points, cap_basis_points, free_references }` |
| 2 | `HarvestWithheldTokensToMint` | `[w] mint`, `[w] token accounts...` | none |
| 3 | `WithdrawWithheldTokensFromMint` | `[w] mint`, `[w] sink`, `[w] fee_destination` | none |

`Initialize` must run before `InitializeMint`, like every mint extension. It rejects
`floor > cap`, `cap > 10,000` and `sink_share > 10,000`.

`Set` requires the authority. It cannot change `sink_share_basis_points`.

`HarvestWithheldTokensToMint` is permissionless and skips accounts that are not token
accounts of the mint or that lack the account extension, logging and continuing, the same
way the transfer fee harvest does. Frozen accounts are harvested.

`WithdrawWithheldTokensFromMint` is permissionless. It splits the mint's `withheld_amount`
into `sink_share_basis_points` for the sink and the remainder for `fee_destination`,
zeroes the mint's withheld amount, and credits both. It fails with
`SlotReferenceFeeInvalidSink` if the sink account is not owned by the incinerator or is the
same account as the destination, with `SlotReferenceFeeDestinationMismatch` if the
destination is not the configured one, with `MintMismatch` if either account is for
another mint, and with `AccountFrozen` if either is frozen.

`SetAuthority` with `AuthorityType::SlotReferenceFee` (18) transfers or revokes the
authority.

`spl_token_2022_interface::extension::slot_reference_fee::instruction::transfer_checked_writable_mint`
builds an ordinary `TransferChecked` with the mint marked writable, for clients that have
not yet been updated.

## Transfer semantics

Inside `Processor::process_transfer`, after the transfer fee (if any) has been computed
and after the self-transfer early return:

```
if mint has SlotReferenceFeeConfig:
    require mint_info.is_writable              // else SlotReferenceFeeMintNotWritable
    now = Clock::get().slot
    if config.slot != now { config.slot = now; config.count = 0 }
    config.count += 1
    n = config.count
    bps = 0 if n <= free_references else min(floor * n * n, cap, 10_000)
    fee = ceil((amount - transfer_fee) * bps / 10_000)
else:
    fee = 0

source.amount      -= amount
destination.amount += amount - transfer_fee - fee
destination.withheld_amount (SlotReferenceFeeAmount) += fee
```

Ordering with other extensions: `SlotReferenceFee` is applied after `TransferFee` and
before the `TransferHook` CPI, on the amount that reached the destination. A mint may
carry both fees. A `Transfer` without the mint (the deprecated unchecked form) fails with
`MintRequiredForTransfer` when the source carries the account extension, the same as for
transfer fees, hooks and pausable mints.

`Burn`, `MintTo`, `Approve`, `Revoke` and `CloseAccount` are not references. A delegated
`TransferChecked` is. A self-transfer returns before the counter is touched.

`TransferCheckedWithFee` still checks only the transfer fee against the expected value,
because the slot reference fee depends on how many references preceded the transfer in
the slot and cannot be known exactly when the transaction is built. Clients that want a
bound on it read the mint's `slot` and `count` and set slippage accordingly, which is what
they do for every other source of slippage today.

## The mint must be writable

This is the one visible change. A mint with `SlotReferenceFee` must be passed as writable
in every transfer, because the counter lives in it.

1. **Serialization.** Solana's write lock on the mint means all transfers of the mint in a
   slot execute sequentially. That is the inherent price of a *global* per-mint counter
   and it is the same trade the Ethereum draft makes: a token that opts in gives up
   parallelism for a price on repetition. A launchpad token in its first hour is exactly
   the kind of mint that wants that trade. USDC would never enable it, and it cannot be
   enabled after initialization, so no existing mint changes.
2. **Client SDKs.** `createTransferCheckedInstruction` marks the mint read-only. The
   Rust client in this branch adds `transfer_checked_writable_mint`; the JS client needs
   the same one-line change. A transaction built without it fails with the explicit
   `SlotReferenceFeeMintNotWritable` error rather than a bare privilege error, so the
   failure is diagnosable.

An alternative that keeps the mint read-only is a per-account counter (`slot`, `count` on
the source token account, which is already writable). It prices repetition per actor per
slot instead of per mint. It is defeated by a fresh token account per transaction, but
each of those needs tokens moved into it, and that move is itself a counted transfer on
the funding account. The global form is what this branch implements; the per-account form
is a strict subset and could ship as a flag.

## Opting in and opting out

**A mint that enables the extension** gets exactly this: the second and later transfers
of the mint in a slot pay `floor * n²` in kind, half (by default) to a sealed sink and
half to the fee destination fixed at initialization. Pool spam, price ladders quoted by
initializing pools, same-slot add and remove, and bundles that split legs across
transactions all pay, because the counter is per mint and per slot, not per signer. So
does the mint's own organic volume once it exceeds `free_references` in a slot. That, and
the writable-mint serialization, is the price of the choice. The extension does not stop a
sandwich: a sandwich is two transfers, not twenty. It cannot be added after
initialization and cannot be removed, so a launchpad cannot enable it for the first hour
and then sell the surface. And the initializer's half is a token account of the mint,
visible to everyone; if it wants that half as SOL it has to sell in the open like anyone
else, because turning the token into SOL needs a venue, and a venue is the dapp-level
dependency this extension refuses to have.

**A mint that does not enable it** changes nothing for itself: same transfers, same cost,
same machines. Wallets, explorers and terminals can read the mint's extensions and show
it. A launchpad whose mints do not carry the extension is stating, in a way any interface
can display, that it is fine with its users being order flow for the machine. That is a
legitimate position; the extension only makes it visible.

**For extractors** nothing is banned. On a mint without the extension the machine runs as
today. On a mint with it, the price grows with the size of the machine's own surface, and
one arbitrage stays cheap. Extraction as a practice, the same legs on every launch, is
what becomes expensive.

## Numbers

`floor_basis_points = 10`, `free_references = 1`, `cap_basis_points = 10_000`:

| n-th reference in slot | fee |
|---|---|
| 1 | 0 |
| 2 | 0.40% |
| 3 | 0.90% |
| 5 | 2.5% |
| 10 | 10% |
| 31 | 96.1% |
| 32 | 100% (cap) |

A pump-shaped launch that seeds nine pools and walks a ladder in one slot pays 0.4 + 0.9 +
... + 8.1 percent on its own legs before any victim appears, and the counter is global, so
splitting the legs across wallets or bundles in the same slot changes nothing.

## Security considerations

- **Griefing.** Anyone can push a mint's counter up early in a slot by transferring it
  repeatedly. They give up their own tokens at the escalating rate to do it, into a sink
  and a destination they do not control, and a slot is 400 ms. This is spam with a
  superlinear price, not an exploit.
- **Clock.** `Clock::get()` is the runtime's view of the current slot and is identical for
  every transaction in the slot; there is no oracle to manipulate.
- **Determinism.** The counter is ordinary account data, replayed identically by every
  validator; there is no off-chain state.
- **Compute.** One extension lookup, one clock read and a few integer operations per
  transfer, on the order of `TransferFee`'s cost.
- **Rounding.** Fees round up, like transfer fees, so a 1-lamport transfer as the second
  reference pays 1 lamport. Withdrawal splits round the sink share down and give the
  remainder to the destination.
- **Overflow.** All arithmetic is checked; `count` is a `u64` and cannot realistically wrap
  in a slot.

## Tests

`clients/rust-legacy/tests/slot_reference_fee.rs` runs against the program in
`solana-program-test`:

- initialization stores the configuration; a `floor > cap` schedule is rejected;
- three transfers in one slot pay 0, 40 bp and 90 bp, the count reads 3, a warp to the
  next slot resets it, harvest moves the withheld total to the mint, withdrawal splits it
  half to the incinerator's associated account and half to the destination;
- the 32nd reference at 10 bp is capped at 100 percent and the destination receives
  nothing;
- a transfer with the mint read-only fails with `SlotReferenceFeeMintNotWritable`;
- a withdrawal to an account not owned by the incinerator, or to a destination other than
  the configured one, fails;
- an account with withheld fees cannot be closed;
- `Set` needs the authority, changes the schedule, and is refused after the authority is
  revoked through `SetAuthority`.

`interface/src/extension/slot_reference_fee/mod.rs` has unit tests for the schedule, the
cap, rounding, the slot reset and the split.

## Rollout

1. This branch: extension type, state, instructions, processor, transfer path, close
   check, set-authority arm, Rust client init params and tests.
2. JS client helpers (mint writable in `createTransferCheckedInstruction` when the mint
   carries the extension; `initialize`, `set`, `harvest`, `withdraw` builders).
3. Program feature gate and deploy, as with every extension addition.
4. Launchpads initialize mints with the extension. Nothing else on Solana changes.

## Relationship to the Ethereum draft

EIP-12384 (ethereum/EIPs#12384) specifies the same counter for the EVM: block-scoped,
per self-enrolled address, global, quadratic, paid in gas, half to a no-owner perpetual
stake and half to a stake vault the enroller names. The Solana version pays in the token
because the token program cannot charge lamports; the incinerator-owned sink is the
closest equivalent to the perpetual stake. Nothing is burned on either chain, and nothing
reaches the extractor or the block producer.
