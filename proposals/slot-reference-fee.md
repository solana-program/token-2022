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
| fast ratchet: the n-th transfer of the mint in a slot pays `floor * n²` bp, capped, after `free_references` free ones, charged only to an account already on its third own transfer in the slot | `SlotReferenceFeeConfig::reference`, `SlotReferenceFeeAmount::reference_in_slot`, `FAST_OWN_MIN` |
| transfers under `min_reference_amount` never count on the fast ratchet | `counts_globally` |
| slow ratchet: the m-th transfer out of the same token account in a window of `slow_window_slots` pays `slow_floor * m²` bp, capped, after `slow_free_references` free ones | `SlotReferenceFeeAmount::reference` on the source account and `slow_fee_basis_points` |
| a transfer pays the larger of the two | `combined_fee_basis_points`, `calculate_fee_at` |
| the fast count is global per mint, not per signer; the slow count is per token account | the fast counter lives in the mint, the slow one in the source account's extension |
| a new slot resets the fast count; a new window resets the slow one | both compare `Clock::get().slot` to what they stored |
| fees are withheld on the destination, never on the sender | `SlotReferenceFeeAmount.withheld_amount`, like `TransferFeeAmount` |
| accounts with withheld fees cannot be closed | `closable` check in `process_close_account` |
| harvest is permissionless | `HarvestWithheldTokensToMint` takes any accounts of the mint |
| withdrawal is permissionless and goes only to the settler's token account | `WithdrawWithheldTokensFromMint` requires the receiving account's owner to be the configured `settler` |
| the fee destination is a stake account with the initializer's withdraw authority and lockup | `Initialize` and `Set` read the account: owner is the stake program, state is initialized or delegated, `authorized.withdrawer == stake_withdrawer`, `lockup.epoch >= stake_lockup_epoch` |
| nothing is burned | no supply change anywhere in the extension; the settler stakes both halves |
| the mint must be writable in transfers | `SlotReferenceFeeMintNotWritable` if it is not |
| every token account of the mint carries the account extension | `required_init_account_extensions` |
| cannot combine with confidential transfers | `check_for_invalid_mint_extension_combinations`: the fee needs to see amounts |
| schedules and destination can be changed only by the authority, and the authority can be revoked | `Set`, `AuthorityType::SlotReferenceFee` |
| the settler, the required withdrawer and the required lockup are immutable | not present in `Set` |

## State

### Mint extension `SlotReferenceFeeConfig`

```rust
#[repr(C)]
pub struct SlotReferenceFeeConfig {
    /// Optional authority to update the fee schedules and move the fee destination
    /// to another qualifying stake account. None makes the configuration immutable.
    pub authority: MaybeNull<Address>,
    /// Stake account the staked half of every settlement goes into.
    pub fee_destination: Address,
    /// Fast ratchet: fee for the n-th reference in a slot is floor * n * n bp.
    pub floor_basis_points: U16,
    /// Fast ratchet cap, in basis points (at most 10,000).
    pub cap_basis_points: U16,
    /// Fast ratchet: references per slot that carry no fee.
    pub free_references: U16,
    /// Slow ratchet: an account's m-th reference in a window pays slow_floor * m * m bp.
    pub slow_floor_basis_points: U16,
    /// Slow ratchet cap, in basis points.
    pub slow_cap_basis_points: U16,
    /// Slow ratchet: references per window per account that carry no fee.
    pub slow_free_references: U16,
    /// Slow ratchet window, in slots.
    pub slow_window_slots: U64,
    /// Owner of the only token account withdrawals of withheld fees may go to.
    pub settler: Address,
    /// Withdraw authority `fee_destination` must carry, set by whoever initialized.
    pub stake_withdrawer: Address,
    /// Earliest lockup epoch `fee_destination` may carry, set by whoever initialized.
    pub stake_lockup_epoch: U64,
    /// Transfers below this many tokens do not count on the fast ratchet.
    pub min_reference_amount: U64,
    /// Slot the fast counter belongs to. Reset whenever the clock moves past it.
    pub slot: U64,
    /// References to this mint in `slot` so far.
    pub count: U64,
    /// Withheld fees harvested to the mint and not yet withdrawn.
    pub withheld_amount: U64,
}
```

`ExtensionType::SlotReferenceFeeConfig`, a mint extension. Fixed size.

### Account extension `SlotReferenceFeeAmount`

```rust
#[repr(C)]
pub struct SlotReferenceFeeAmount {
    /// Amount withheld during transfers, to be harvested to the mint
    pub withheld_amount: U64,
    /// Slow ratchet: the window this account last referenced the mint in
    pub window: U64,
    /// Slow ratchet: references by this account in that window
    pub count: U64,
    /// Fast gate: the slot this account last referenced the mint in
    pub slot: U64,
    /// Fast gate: references by this account in that slot
    pub slot_count: U64,
}
```

`ExtensionType::SlotReferenceFeeAmount`, required on every token account of a mint that
carries the config, exactly like `TransferFeeAmount`. The slow counter lives here because
the source account is already writable in every transfer; keying it on the account is
what makes it impossible for anyone to raise anyone else's count.

### The settler and the stake destination

Both fee buckets are native stake. The token program cannot sell tokens or delegate SOL, so
it does the two things it can: it lets withheld fees leave only towards one address, the
`settler`, and it refuses any `fee_destination` that is not a stake account nobody but the
named party can withdraw from, and not before the named epoch.

The settler is a program of the issuer's choosing, fixed at initialization. It receives
every withdrawal in its own token account, sells for SOL, and stakes both halves: one half
into a stake account whose withdraw authority is the incinerator (`1nc1nerator11111111111111111111111111111111`), which is
the chain's perpetual stake and belongs to nobody; the other half into `fee_destination`,
the dapp's stake, which the initializer bound to a withdraw authority (`stake_withdrawer`)
and a minimum lockup epoch (`stake_lockup_epoch`). The program verifies the destination by
reading the account: `StakeStateV2` is a bincode enum whose tag (1 initialized, 2 stake)
and `Meta` (rent reserve, `Authorized { staker, withdrawer }`, `Lockup { unix_timestamp,
epoch, custodian }`) sit at fixed offsets; `StakeMeta::parse` reads those and nothing
else. A wallet, a token account or an uninitialized stake account is refused with
`SlotReferenceFeeDestinationNotStake`.

## Instructions

All under `TokenInstruction::SlotReferenceFeeExtension` (discriminant 47), with a second
byte selecting the sub-instruction, the same layout every extension uses.

| # | instruction | accounts | data |
|---|---|---|---|
| 0 | `Initialize` | `[w] mint`, `[] fee_destination` (stake account) | `InitializeInstructionData { authority, fee_destination, floor_basis_points, cap_basis_points, free_references, slow_floor_basis_points, slow_cap_basis_points, slow_free_references, slow_window_slots, settler, stake_withdrawer, stake_lockup_epoch }` |
| 1 | `Set` | `[w] mint`, `[] fee_destination` (stake account), `[s] authority` (or multisig + signers) | `SetInstructionData { fee_destination, floor_basis_points, cap_basis_points, free_references, slow_floor_basis_points, slow_cap_basis_points, slow_free_references, slow_window_slots }` |
| 2 | `HarvestWithheldTokensToMint` | `[w] mint`, `[w] token accounts...` | none |
| 3 | `WithdrawWithheldTokensFromMint` | `[w] mint`, `[w] settler token account` | none |

`Initialize` must run before `InitializeMint`, like every mint extension. It rejects
`floor > cap` and `cap > 10,000` on either ratchet, a zero settler, and a fee destination
that is not a stake account carrying `stake_withdrawer` and a lockup epoch of at least
`stake_lockup_epoch`.

`Set` requires the authority. It may change both schedules and move the destination, but
only to another stake account with the same withdrawer and at least the lockup the
initializer set. It cannot change the settler, the withdrawer or the lockup floor.

`HarvestWithheldTokensToMint` is permissionless and skips accounts that are not token
accounts of the mint or that lack the account extension, logging and continuing, the same
way the transfer fee harvest does. Frozen accounts are harvested.

`WithdrawWithheldTokensFromMint` is permissionless. It moves the mint's whole
`withheld_amount` to the given token account, which must belong to this mint and be owned
by the configured `settler`, else `SlotReferenceFeeInvalidSink`; `MintMismatch` if it is
for another mint, `AccountFrozen` if it is frozen.

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
    require mint_info.is_writable                       // else SlotReferenceFeeMintNotWritable
    now = Clock::get().slot
    // fast ratchet, global per mint, gated on the account's own repetition
    if amount - transfer_fee >= min_reference_amount:
        if config.slot != now { config.slot = now; config.count = 0 }
        config.count += 1 ; n = config.count
        if source.slot != now { source.slot = now; source.slot_count = 0 }
        source.slot_count += 1 ; own = source.slot_count
    else: n = 0 ; own = 0                               // dust moves nobody's counter
    fast = 0 if own < 3 or n <= free_references else min(floor * n * n, cap, 10_000)
    // slow ratchet, per source account
    window = now / slow_window_slots
    if source.window != window { source.window = window; source.count = 0 }
    source.count += 1 ; m = source.count
    slow = 0 if m <= slow_free_references else min(slow_floor * m * m, slow_cap, 10_000)
    fee = ceil((amount - transfer_fee) * max(fast, slow) / 10_000)
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
`TransferChecked` is. A self-transfer returns before either counter is touched.

`TransferCheckedWithFee` still checks only the transfer fee against the expected value,
because the slot reference fee depends on how many references preceded the transfer and
cannot be known exactly when the transaction is built. Clients that want a bound on it
read the mint's `slot` and `count` and the source's `window` and `count`, and set slippage
accordingly.

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

**A mint that enables the extension** gets exactly this: repetition pays. The mint's third
and later transfers in a slot pay `floor * n²`, whoever made them; an account's second and
later transfers in a window pay `slow_floor * m²`; a transfer pays the larger, in kind, to
a settler that turns it into stake, half the chain's and half the dapp's. Pool spam, price
ladders quoted by initializing pools, same-slot add and remove, and bundles that split legs
across transactions or wallets pay on the fast ratchet; the same account coming back
minutes later pays on the slow one. So does the mint's own organic volume once it exceeds
`free_references` in a slot, and a person trading twice in a window pays a few basis
points on the second. That, and the writable-mint serialization, is the price of the
choice. The first two references in a slot are free so that the transfer a sandwich is
built around pays nothing. It cannot be added after initialization and cannot be removed,
so a launchpad cannot enable it for the first hour and then sell the surface. And the
dapp's half is stake, bound to the withdraw authority and lockup the initializer chose and
visible to everyone; nobody's fees go to a wallet.

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

Fast ratchet `floor_basis_points = 10`, `free_references = 2`, `cap_basis_points = 10_000`,
charged only to an account on its third own transfer in the slot; slow ratchet
`slow_floor_basis_points = 2`, `slow_free_references = 16`, `slow_cap_basis_points = 10_000`,
`slow_window_slots = 1_512_000` (a week of 400 ms slots); `min_reference_amount` at 0.01% of
supply. These come from replaying two days of one extraction operator on Robinhood Chain
(65 launches, 45,728 transfers, 198 serial or heavy wallets against 2,911 others): the
machine's same-slot repetition came from one wallet at a time (4,690 of 4,713 machine
references landing third or later in a block were from a wallet already on its third), and
it returned to a token 6 to 37 times over about twelve hours while other wallets touched it
3 to 8 times over about seven minutes. With these constants the machine pays 6.3% of its
volume and everyone else 0.19%, with one in twenty-two of their transfers touched; the
first draft's global-only counter charged everyone else 0.53% and touched more than half.

| n-th reference in slot (own 3rd+) | fast fee | m-th by one account in a week | slow fee |
|---|---|---|---|
| 1 | 0 | 1 to 16 | 0 |
| 2 | 0 | 17 | 5.78% |
| 3 | 0.90% | 20 | 8.0% |
| 5 | 2.5% | 30 | 18% |
| 10 | 10% | 50 | 50% |
| 32 | 100% (cap) | 71 | 100% (cap) |

A pump-shaped launch that seeds nine pools and walks a ladder in one slot pays 0.9 + 1.6 +
... + 8.1 percent on its own legs before any victim appears, and the fast counter is
global, so splitting the legs across wallets or bundles in the same slot changes nothing.
A wallet that comes back to the same mint for the seventeenth time in a week pays 5.78%,
and each return after that costs more; a wallet that trades it a dozen times pays nothing.

## Security considerations

- **Griefing.** Nobody can make anyone else pay. The fast fee is charged only to an
  account already on its third own transfer in the slot, so a bystander's swap in a busy
  slot is free whatever the mint's counter says; dust under `min_reference_amount` does not
  move the counter at all; and the slow ratchet is keyed on the source account. A griefer
  can only raise the price of its own repetition.
- **Evasion.** A machine that splits its legs across two accounts in one slot still pays
  the fast ratchet; one that comes back minutes later from a fresh account evades the slow
  ratchet, at the cost of funding that account, which is itself a counted transfer.
- **The destination.** Only its owner, state, withdraw authority and lockup epoch are
  checked. A custodian set on the lockup can lift it early; an initializer that wants the
  lock to be real names a withdrawer and lockup on an account whose custodian is the
  withdrawer itself or the default address, and states so.
- **Clock.** `Clock::get()` is the runtime's view of the current slot and is identical for
  every transaction in the slot; there is no oracle to manipulate.
- **Determinism.** Both counters are ordinary account data, replayed identically by every
  validator; there is no off-chain state.
- **Compute.** Two extension lookups, one clock read and a few integer operations per
  transfer, on the order of `TransferFee`'s cost.
- **Rounding.** Fees round up, like transfer fees, so a 1-lamport transfer as the third
  reference pays 1 lamport.
- **Overflow.** All arithmetic is checked; the counts are `u64` and cannot realistically
  wrap.

## Tests

`clients/rust-legacy/tests/slot_reference_fee.rs` runs against the program in
`solana-program-test`, with a stake account planted for the destination:

- initialization stores the whole configuration; a `floor > cap` schedule is rejected; a
  destination locked to a shorter epoch than required, or one that is not a stake account,
  is refused with `SlotReferenceFeeDestinationNotStake`;
- three transfers in one slot pay 0, 0 and 90 bp (the sender's third in the slot), the
  fast count reads 3, a warp to the next slot resets it, harvest moves the withheld total
  to the mint, withdrawal moves all of it to the settler's token account;
- a bystander sending once in a slot a machine has walked four times pays nothing;
- sixteen touches over a week are free, the seventeenth pays 578 bp, and the next window
  starts over;
- five dust transfers leave the mint's counter at zero;
- the 32nd reference at 10 bp is capped at 100 percent and the destination receives
  nothing;
- a transfer with the mint read-only fails with `SlotReferenceFeeMintNotWritable`;
- a withdrawal to a token account the settler does not own fails;
- an account with withheld fees cannot be closed;
- `Set` needs the authority, refuses a destination with a shorter lockup, accepts one with
  a longer one, changes the schedules, and is refused after the authority is revoked
  through `SetAuthority`.

`interface/src/extension/slot_reference_fee/mod.rs` has unit tests for both schedules, the
caps, rounding, the slot and window resets, the larger-wins rule and the `StakeStateV2`
parser.

## Rollout

1. This branch: extension type, state, instructions, processor, transfer path, close
   check, set-authority arm, Rust client init params and tests.
2. JS client helpers (mint writable in `createTransferCheckedInstruction` when the mint
   carries the extension; `initialize`, `set`, `harvest`, `withdraw` builders).
3. Program feature gate and deploy, as with every extension addition.
4. Launchpads initialize mints with the extension. Nothing else on Solana changes.

## Relationship to the Ethereum draft

EIP-8429 (ethereum/EIPs#12384, discussed at https://ethereum-magicians.org/t/eip-8429-escalating-gas-for-repeated-calls/29798) specifies the same two ratchets for the EVM: a global
block-scoped counter and a per-originator window counter, per self-enrolled address,
quadratic, paid in gas, half to the chain's no-owner sink that can only stake and half to
a stake vault the enroller names. The Solana version pays in the token because the token
program cannot charge lamports; a settler outside the token program turns the tokens into
SOL and stakes both halves, and the token program guarantees the dapp's half can only ever
land in a stake account with the withdraw authority and lockup the initializer chose.
Nothing is burned on either chain, and nothing reaches the extractor, the block producer or
a wallet.
