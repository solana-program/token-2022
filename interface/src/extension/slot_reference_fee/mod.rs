//! Slot reference fee extension: a per-mint, per-slot reference counter with an
//! escalating in-kind fee.
//!
//! The n-th `TransferChecked` of the mint inside one slot pays
//! `floor_basis_points * n * n` basis points of the transferred amount (capped at
//! `cap_basis_points`), with the first `free_references` references in a slot
//! free. The counter lives in the mint, so the mint must be passed as writable
//! to every transfer. Fees are withheld on the destination account exactly like
//! the transfer fee extension, harvested to the mint permissionlessly, and
//! withdrawn permissionlessly to two fixed places: a sink token account owned by
//! the incinerator address, which nobody can sign for, and a `fee_destination`
//! token account chosen at initialization. Nothing is burned.
//!
//! What this prices is repetition of references to the same mint inside one
//! slot: pool spam, price ladders quoted by initializing pools, same-slot add and
//! remove of liquidity, and bundles that split those legs across transactions.
//! A single transfer or a single swap is almost always the first reference in
//! its slot and pays nothing.

use {
    crate::{
        error::TokenError,
        extension::{Extension, ExtensionType},
    },
    bytemuck::{Pod, Zeroable},
    core::{cmp, convert::TryInto},
    solana_address::Address,
    solana_nullable::MaybeNull,
    solana_program_error::ProgramResult,
    solana_zero_copy::unaligned::{U16, U64},
};
#[cfg(feature = "serde")]
use {
    serde::{Deserialize, Serialize},
    serde_with::{As, DisplayFromStr},
};

/// Slot reference fee extension instructions
pub mod instruction;

/// Maximum possible fee in basis points is `100%`, aka 10,000 basis points
pub const MAX_FEE_BASIS_POINTS: u16 = 10_000;
const ONE_IN_BASIS_POINTS: u128 = MAX_FEE_BASIS_POINTS as u128;

/// Owner of every sink token account: the incinerator, an address with no
/// private key. A token account owned by it can never be transferred from or
/// closed, so what the sink receives stays there.
pub fn sink_owner() -> Address {
    solana_sdk_ids::incinerator::id()
}

/// Slot reference fee extension data for mints.
#[repr(C)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct SlotReferenceFeeConfig {
    /// Optional authority to update the fee schedule and the fee destination.
    /// `None` makes the configuration immutable.
    #[cfg_attr(feature = "serde", serde(with = "As::<Option<DisplayFromStr>>"))]
    pub authority: MaybeNull<Address>,
    /// Token account of this mint that receives the non-sink share of every
    /// withdrawal.
    #[cfg_attr(feature = "serde", serde(with = "As::<DisplayFromStr>"))]
    pub fee_destination: Address,
    /// Fee for the n-th reference in a slot is `floor * n * n` basis points.
    pub floor_basis_points: U16,
    /// Hard cap on the fee, in basis points (at most 10,000).
    pub cap_basis_points: U16,
    /// References per slot that carry no fee.
    pub free_references: U16,
    /// Share of every withdrawal that goes to the sink, in basis points. The
    /// rest goes to `fee_destination`. Immutable.
    pub sink_share_basis_points: U16,
    /// Slot the counter belongs to. Reset whenever the clock moves past it.
    pub slot: U64,
    /// References to this mint in `slot` so far.
    pub count: U64,
    /// Withheld fees harvested to the mint and not yet withdrawn.
    pub withheld_amount: U64,
}

impl SlotReferenceFeeConfig {
    /// Ceiling division, as in the transfer fee extension
    fn ceil_div(numerator: u128, denominator: u128) -> Option<u128> {
        numerator
            .checked_add(denominator)?
            .checked_sub(1)?
            .checked_div(denominator)
    }

    /// Fee rate in basis points for the `n`-th reference in a slot.
    pub fn fee_basis_points(&self, n: u64) -> u16 {
        if n <= u64::from(u16::from(self.free_references)) {
            return 0;
        }
        let floor = u16::from(self.floor_basis_points) as u128;
        let cap = u16::from(self.cap_basis_points) as u128;
        let raw = floor.saturating_mul(n as u128).saturating_mul(n as u128);
        cmp::min(raw, cmp::min(cap, ONE_IN_BASIS_POINTS)) as u16
    }

    /// Fee, in tokens, for transferring `pre_fee_amount` as the `n`-th
    /// reference in a slot. Rounded up.
    pub fn calculate_fee(&self, pre_fee_amount: u64, n: u64) -> Option<u64> {
        let basis_points = self.fee_basis_points(n) as u128;
        if basis_points == 0 || pre_fee_amount == 0 {
            return Some(0);
        }
        let numerator = (pre_fee_amount as u128).checked_mul(basis_points)?;
        let fee = Self::ceil_div(numerator, ONE_IN_BASIS_POINTS)?;
        fee.try_into().ok()
    }

    /// Register a reference in `current_slot`, resetting the counter if the
    /// slot moved, and return the reference ordinal (1 for the first in a slot).
    pub fn reference(&mut self, current_slot: u64) -> u64 {
        if u64::from(self.slot) != current_slot {
            self.slot = current_slot.into();
            self.count = 0u64.into();
        }
        let n = u64::from(self.count).saturating_add(1);
        self.count = n.into();
        n
    }

    /// Split a withdrawn amount into `(sink_share, fee_destination_share)`.
    pub fn split(&self, amount: u64) -> Option<(u64, u64)> {
        let share = u16::from(self.sink_share_basis_points) as u128;
        let sink = (amount as u128)
            .checked_mul(share)?
            .checked_div(ONE_IN_BASIS_POINTS)?;
        let sink: u64 = sink.try_into().ok()?;
        Some((sink, amount.checked_sub(sink)?))
    }
}

impl Extension for SlotReferenceFeeConfig {
    const TYPE: ExtensionType = ExtensionType::SlotReferenceFeeConfig;
}

/// Slot reference fee extension data for accounts.
#[repr(C)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct SlotReferenceFeeAmount {
    /// Amount withheld during transfers, to be harvested to the mint
    pub withheld_amount: U64,
}

impl SlotReferenceFeeAmount {
    /// Check if the extension is in a closable state
    pub fn closable(&self) -> ProgramResult {
        if self.withheld_amount == 0.into() {
            Ok(())
        } else {
            Err(TokenError::AccountHasWithheldSlotReferenceFees.into())
        }
    }
}

impl Extension for SlotReferenceFeeAmount {
    const TYPE: ExtensionType = ExtensionType::SlotReferenceFeeAmount;
}

#[cfg(test)]
mod test {
    use super::*;

    fn config(floor: u16, cap: u16, free: u16, sink_share: u16) -> SlotReferenceFeeConfig {
        SlotReferenceFeeConfig {
            authority: None.try_into().unwrap(),
            fee_destination: Address::new_unique(),
            floor_basis_points: floor.into(),
            cap_basis_points: cap.into(),
            free_references: free.into(),
            sink_share_basis_points: sink_share.into(),
            slot: 0.into(),
            count: 0.into(),
            withheld_amount: 0.into(),
        }
    }

    #[test]
    fn schedule_is_quadratic_with_free_first_and_cap() {
        let c = config(10, 10_000, 1, 5_000);
        assert_eq!(c.fee_basis_points(1), 0);
        assert_eq!(c.fee_basis_points(2), 40);
        assert_eq!(c.fee_basis_points(3), 90);
        assert_eq!(c.fee_basis_points(5), 250);
        assert_eq!(c.fee_basis_points(10), 1_000);
        assert_eq!(c.fee_basis_points(31), 9_610);
        assert_eq!(c.fee_basis_points(32), 10_000);
        assert_eq!(c.fee_basis_points(1_000_000), 10_000);
    }

    #[test]
    fn cap_below_max_holds() {
        let c = config(10, 500, 0, 5_000);
        assert_eq!(c.fee_basis_points(1), 10);
        assert_eq!(c.fee_basis_points(7), 490);
        assert_eq!(c.fee_basis_points(8), 500);
    }

    #[test]
    fn fee_rounds_up_and_zero_cases() {
        let c = config(10, 10_000, 1, 5_000);
        assert_eq!(c.calculate_fee(1_000_000, 1), Some(0));
        assert_eq!(c.calculate_fee(0, 2), Some(0));
        assert_eq!(c.calculate_fee(1_000_000, 2), Some(4_000));
        assert_eq!(c.calculate_fee(1, 2), Some(1)); // 0.4% of 1, rounded up
        assert_eq!(c.calculate_fee(1_000_000, 32), Some(1_000_000));
        assert_eq!(c.calculate_fee(u64::MAX, 32), Some(u64::MAX));
    }

    #[test]
    fn counter_resets_on_new_slot() {
        let mut c = config(10, 10_000, 1, 5_000);
        assert_eq!(c.reference(100), 1);
        assert_eq!(c.reference(100), 2);
        assert_eq!(c.reference(100), 3);
        assert_eq!(c.reference(101), 1);
        assert_eq!(u64::from(c.slot), 101);
        assert_eq!(c.reference(101), 2);
    }

    #[test]
    fn split_gives_sink_its_share() {
        let c = config(10, 10_000, 1, 5_000);
        assert_eq!(c.split(1_000), Some((500, 500)));
        assert_eq!(c.split(1_001), Some((500, 501)));
        assert_eq!(c.split(0), Some((0, 0)));
        let all = config(10, 10_000, 1, 10_000);
        assert_eq!(all.split(7), Some((7, 0)));
    }
}
