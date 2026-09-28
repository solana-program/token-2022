# Token-2022 extension proposal: SlotReferenceFee

Target: `solana-program/token-2022` (a new mint extension plus a matching account extension).
Status: draft for discussion. Author: Jarett Dunn (@staccDOTsol).

## One paragraph

A mint extension that keeps one global, per-slot reference counter *in the mint account*
and charges an in-kind fee of `floor_bps * n²` on the n-th transfer of the mint in the
current slot, capped, with the fee burned or withheld. Because Token-2022 is the program
that executes every transfer of every mint that carries the extension, this is enforced on
every DEX, every AMM, every terminal, every bundle, whether or not they know about it. It
needs no new accounts: the mint and the Clock sysvar are already in reach of every
`TransferChecked`.

## Why this and not a transfer hook

A transfer hook can reject a transfer and can keep its own counters in PDAs, but it cannot
take a fee from the transfer without extra accounts and a delegate, and it runs after the
fact. A program-level extension is the cheapest possible form: the counter is two fields
in the mint's TLV data, and the fee is computed inside `process_transfer` exactly where
`TransferFee` already computes its fee. The point of doing it inside the token program is
the same point as putting it inside the EVM on the Ethereum side: it is not a dapp-level
fix. There is no venue to route around.

## What it prices

The 28 million sandwiches in arXiv:2609.28115 are one shape; cataloguing is the other.
The same machine that walked a Robinhood Chain launch with 59 pools, a 17x price ladder
and same-block add/remove is reproduced on Solana in `staccDOTsol/the-book`: nine Orca
pools, eight of them quoting 5x to 5000x with no liquidity, legs in Jito bundles,
creator fees swept every cycle. Every step references the same mint many times in the
same slot. A per-mint per-slot counter prices exactly that and nothing else. A human
transfer or one swap is the first reference in its slot almost always and pays nothing.

## Opting in and opting out

Nothing here is a judgement on memecoins. A mint is a mint; a launch is a market; the
program does not care what is being launched. What the extension prices is a practice:
the same machine, run against every launch on the network, because repetition is free.

**A mint that enables the extension** gets exactly this: the second and later transfers
of the mint in a slot pay `floor_bps * n²` in kind, half burned and half to the
`fee_destination` fixed at initialization. Pool spam, price ladders quoted by initializing
pools, same-slot add and remove, and bundles that split legs across transactions all pay,
because the counter is per mint and per slot, not per signer. So does the mint's own
organic volume once it exceeds `free_refs` in a slot. That, and the writable-mint
serialization, is the price of the choice. The extension does not stop a sandwich: a
sandwich is two transfers, not twenty. It cannot be added after initialization and cannot
be removed, so a launchpad cannot enable it for the first hour and then sell the surface.
And the initializer's half is a token account of the mint, visible to everyone; if it
wants that half as SOL it has to sell in the open like anyone else.

**A mint that does not enable it** changes nothing for itself: same transfers, same cost,
same machines. Wallets, explorers and terminals can read the mint's extensions and show
it. A launchpad whose mints do not carry the extension is stating, in a way any interface
can display, that it is fine with its users being order flow for the machine. That is a
legitimate position; the extension only makes it visible.

**For extractors** nothing is banned. On a mint without the extension the machine runs as
today. On a mint with it, the price grows with the size of the machine's own surface, and
one arbitrage stays cheap. Extraction as a practice, the same legs on every launch, is
what becomes expensive.

## State

### Mint extension `SlotReferenceFee` (new `ExtensionType`)

```rust
#[repr(C)]
pub struct SlotReferenceFee {
    /// Authority that may update floor/cap; None = immutable.
    pub authority: OptionalNonZeroPubkey,
    /// Fee for the n-th reference in a slot is floor_bps * n * n, in basis points.
    pub floor_bps: PodU16,          // recommended 10
    /// Hard cap in basis points (<= 10_000).
    pub cap_bps: PodU16,            // recommended 10_000
    /// References in `slot` that are not charged (recommended 1).
    pub free_refs: PodU16,
    /// If true, the fee is burned; if false it is withheld on the destination account
    /// exactly like TransferFeeAmount and harvested by `withdraw_withheld_authority`.
    pub burn: PodBool,
    /// Slot the counter belongs to. Reset when Clock::slot moves past it.
    pub slot: PodU64,
    /// References of this mint in `slot` so far.
    pub count: PodU32,
}
```

### Account extension `SlotReferenceFeeAmount` (optional, only when `burn == false`)

Same layout and semantics as `TransferFeeAmount { withheld_amount }`. Reuses the existing
`harvest_withheld_tokens_to_mint` / `withdraw_withheld_tokens_from_accounts` flow.

## Instructions

Under a new `TokenInstruction::SlotReferenceFeeExtension(u8)` family, mirroring
`TransferFeeExtension`:

| # | instruction | accounts | notes |
|---|---|---|---|
| 0 | `InitializeSlotReferenceFee { authority, floor_bps, cap_bps, free_refs, burn }` | `[w] mint` | before `InitializeMint`, like every mint extension |
| 1 | `SetSlotReferenceFee { floor_bps, cap_bps, free_refs }` | `[w] mint, [s] authority` | only while `authority` is set |
| 2 | `RevokeSlotReferenceFeeAuthority` | `[w] mint, [s] authority` | makes the config immutable |
| 3 | `HarvestWithheldToMint` / `WithdrawWithheld*` | as TransferFee | only when `burn == false` |

No new transfer instruction. `TransferChecked` (and `TransferCheckedWithFee`) is required,
as it already is for mints with `TransferFee` or `TransferHook`; plain `Transfer` fails with
`TokenError::MintRequiredForTransfer`.

## Transfer semantics (inside `process_transfer`)

```
mint = get_extension::<SlotReferenceFee>(mint_account)   // mint must be writable
now  = Clock::get()?.slot                                 // syscall, no account needed
if mint.slot != now { mint.slot = now; mint.count = 0 }
mint.count += 1
n = mint.count
fee_bps = if n <= free_refs { 0 } else { min(floor_bps * n * n, cap_bps) }
fee = amount * fee_bps / 10_000        // rounded up, like TransferFee
net = amount - fee
source -= amount
dest   += net
if burn { mint.supply -= fee } else { dest.withheld_amount += fee }
emit ... (no event system; the fee is observable from balances and the mint's supply)
```

Ordering with other extensions: `SlotReferenceFee` is applied after `TransferFee` and
before `TransferHook`, on the amount that reached the destination. A mint MAY carry both.

`Burn`, `MintTo`, `CloseAccount`, `Approve`, `Revoke` and CPI-driven `Transfer` from a
delegate all go through the same path; a burn or mint does not count as a reference, a
delegated transfer does. `ConfidentialTransfer` mints MUST NOT combine with this
extension (the program cannot see amounts; refuse at `InitializeMint`).

## Where the fee goes

The fee is in kind: the token program cannot charge lamports from the source owner. So the
split is:

- half burned (`mint.supply -= fee / 2`),
- half moved to the mint's **sink**: a token account owned by the token program at
  `PDA(["slot-reference-sink", mint])`, created at `InitializeSlotReferenceFee`. It has no
  close authority, no owner key, and the program has no instruction that moves tokens out
  of it. It is a permanent, visible reserve of the token that grows with every machine
  that walks the mint.

- the other half to `fee_destination`, a token account of this mint chosen by whoever
  initializes the extension (`burn` and `withheld` modes in the layout above are replaced
  by `sink_share_bps`, recommended 5_000, and `fee_destination: Pubkey`).

The Ethereum draft can require the initializer's half to be a stake account, because there
the fee is ETH. Here it is the token, and turning the token into SOL needs a venue, which is
the dapp-level dependency this proposal refuses to have. So the program enforces only that
`fee_destination` is a token account of the mint, set at init and changeable by
`authority` if one exists. If the initializer wants it staked, the honest path is off
program: point `fee_destination` at a PDA of a crank that sells and delegates, and accept
that the crank is a dapp. The sink half needs no venue and no crank; it never moves.

## The mint must be writable

This is the one visible change for integrators: a mint with `SlotReferenceFee` must be
passed as writable in every transfer, because the counter lives in it. Two consequences:

1. **Serialization.** Solana's write lock on the mint means all transfers of the mint in a
   slot execute sequentially. That is the inherent price of a *global* per-mint counter
   and it is the same trade the Ethereum draft makes: a token that enrolls gives up
   parallelism for a price on repetition. A launchpad token in its first hour is
   exactly the kind of mint that wants that trade. USDC would never enable it, and it
   cannot be enabled on a mint after initialization, so no existing mint changes.
2. **Client SDKs.** `createTransferCheckedInstruction` marks the mint read-only. The SDK
   helper for this extension marks it writable; a transaction built without that fails
   with the standard "account not writable" error, which is the same failure mode as
   forgetting a transfer-hook's extra accounts today.

An alternative that keeps the mint read-only is a *per-account* counter (`slot`, `count`
on the source token account, which is already writable). It prices repetition per actor
per slot instead of per mint. It is defeated by a fresh token account per transaction,
but each of those needs tokens moved into it, and that move is itself a counted transfer
on the funding account. The global form is what this proposal specifies; the per-account
form is a strict subset and could ship as a flag.

## Numbers

`floor_bps = 10`, `free_refs = 1`, `cap_bps = 10_000`:

| n-th reference in slot | fee |
|---|---|
| 1 | 0 |
| 2 | 0.40% |
| 3 | 0.90% |
| 5 | 2.5% |
| 10 | 10% |
| 32 | 100% (cap) |

A pump-shaped launch that seeds nine pools and walks a ladder in one slot pays 0.4 + 0.9 +
... + 8.1% on its own legs before any victim appears, and the counter is global, so
splitting the legs across wallets or bundles in the same slot changes nothing.

## Security considerations

- **Griefing.** Anyone can spend the fee to push a mint's counter up early in a slot. They
  burn (or leave withheld) their own tokens at the escalating rate to do it, and a slot is
  400 ms. This is spam with a superlinear price, not an exploit.
- **Clock.** `Clock::get()` is the runtime's view of the current slot and is identical for
  every transaction in the slot; there is no oracle to manipulate.
- **Determinism.** The counter is ordinary account data, replayed identically by every
  validator; there is no off-chain state.
- **Compute.** One extension lookup and a few integer ops per transfer, on the order of
  `TransferFee`'s cost.

## Rollout

1. Extension type, state, instruction set, `process_transfer` hook, tests in `token-2022`.
2. `spl-token-2022` JS / Rust client helpers (mint writable, `TransferChecked` builders).
3. Program feature gate, as with every extension addition.
4. Launchpads (pump.fun-shaped or otherwise) initialize mints with the extension; nothing
   else on Solana changes.

## Relationship to the Ethereum draft

`research/eip-draft-escalating-reference-gas.md` specifies the same counter for the EVM:
block-scoped, per enrolled address, global, quadratic, paid in gas to the protocol. The
Solana version pays in the token because the token program cannot charge lamports; the
`burn` flag is the closest equivalent to "paid to the protocol, not the extractor".
