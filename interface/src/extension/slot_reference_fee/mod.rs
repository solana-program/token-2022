//! Slot reference fee extension: two reference counters with an escalating
//! in-kind fee, settled into stake.
//!
//! Fast ratchet: the n-th `TransferChecked` of the mint inside one slot,
//! whoever made it, pays `floor_basis_points * n * n` basis points of the
//! transferred amount (capped at `cap_basis_points`), with the first
//! `free_references` in a slot free. Slow ratchet: the m-th transfer out of the
//! same token account inside a window of `slow_window_slots` pays
//! `slow_floor_basis_points * m * m`, with the first `slow_free_references`
//! free. A transfer pays the larger. The fast counter lives in the mint, so the
//! mint must be passed as writable to every transfer; the slow counter lives in
//! the source token account's extension.
//!
//! Fees are withheld on the destination account exactly like the transfer fee
//! extension, harvested to the mint permissionlessly, and withdrawn
//! permissionlessly to one place: a token account owned by the `settler`. The
//! settler sells them for SOL, burns half and puts half into `fee_destination`,
//! which must be a stake account carrying the withdraw authority and the lockup
//! that whoever initialized the mint required. The token program never pays a
//! wallet.
//!
//! What this prices is repetition of references to the same mint: pool spam,
//! price ladders quoted by initializing pools, add and remove of liquidity in
//! one slot or by one account minutes apart, and bundles that split those legs
//! across transactions or wallets. A single transfer or a single swap is almost
//! always free.

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

/// Instructions for the extension
pub mod instruction;

/// Fees are in basis points; nothing may exceed 100%.
pub const MAX_FEE_BASIS_POINTS: u16 = 10_000;
const ONE_IN_BASIS_POINTS: u128 = MAX_FEE_BASIS_POINTS as u128;

/// Owner every `fee_destination` must have: the stake program. Fees end up as
/// stake, never in a wallet.
pub fn stake_program_id() -> Address {
    solana_sdk_ids::stake::id()
}

/// What the program reads off a stake account. `StakeStateV2` is a bincode enum:
/// tag `u32` at 0 (1 = Initialized, 2 = Stake), then `Meta` at 4:
/// rent_exempt_reserve u64, authorized.staker, authorized.withdrawer,
/// lockup.unix_timestamp i64, lockup.epoch u64, lockup.custodian.
pub struct StakeMeta {
    /// May delegate and deactivate
    pub staker: Address,
    /// May withdraw once the lockup has passed
    pub withdrawer: Address,
    /// Lockup: no withdrawal before this unix time
    pub lockup_unix_timestamp: i64,
    /// Lockup: no withdrawal before this epoch
    pub lockup_epoch: u64,
    /// May lift the lockup
    pub custodian: Address,
}

impl StakeMeta {
    /// Bytes an initialized stake account carries before the delegation
    pub const MIN_LEN: usize = 4 + 8 + 32 + 32 + 8 + 8 + 32;

    /// Parse an initialized or delegated stake account; `None` for anything else.
    pub fn parse(data: &[u8]) -> Option<Self> {
        if data.len() < Self::MIN_LEN {
            return None;
        }
        let tag = u32::from_le_bytes(data[0..4].try_into().ok()?);
        if tag != 1 && tag != 2 {
            return None;
        }
        let key = |o: usize| -> Option<Address> {
            Some(Address::new_from_array(data[o..o + 32].try_into().ok()?))
        };
        Some(Self {
            staker: key(12)?,
            withdrawer: key(44)?,
            lockup_unix_timestamp: i64::from_le_bytes(data[76..84].try_into().ok()?),
            lockup_epoch: u64::from_le_bytes(data[84..92].try_into().ok()?),
            custodian: key(92)?,
        })
    }
}

/// Slot reference fee extension data for mints.
///
/// Two ratchets, and a transfer pays the larger:
///
/// - fast, global, per slot: the n-th transfer of this mint in a slot, whoever
///   made it, pays `floor * n * n` basis points after `free_references` free ones;
/// - slow, per token account, per window of `slow_window_slots`: the m-th
///   transfer out of the same account in a window pays `slow_floor * m * m`
///   basis points after `slow_free_references` free ones.
///
/// Fees are withheld in kind, harvested to the mint, and withdrawn only to the
/// `settler`'s token account. The settler sells them for SOL, burns half and puts
/// half into `fee_destination`, a stake account carrying the withdraw authority
/// and the lockup whoever initialized the mint required.
#[repr(C)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct SlotReferenceFeeConfig {
    /// Optional authority to update the fee schedules and move the fee
    /// destination to another qualifying stake account. `None` makes the
    /// configuration immutable.
    #[cfg_attr(feature = "serde", serde(with = "As::<Option<DisplayFromStr>>"))]
    pub authority: MaybeNull<Address>,
    /// Stake account the staked half of every settlement goes into.
    #[cfg_attr(feature = "serde", serde(with = "As::<DisplayFromStr>"))]
    pub fee_destination: Address,
    /// Fast ratchet: fee for the n-th reference in a slot is `floor * n * n` bp.
    pub floor_basis_points: U16,
    /// Fast ratchet cap, in basis points (at most 10,000).
    pub cap_basis_points: U16,
    /// Fast ratchet: references per slot that carry no fee.
    pub free_references: U16,
    /// Slow ratchet: an account's m-th reference in a window pays `slow_floor * m * m` bp.
    pub slow_floor_basis_points: U16,
    /// Slow ratchet cap, in basis points.
    pub slow_cap_basis_points: U16,
    /// Slow ratchet: references per window per account that carry no fee.
    pub slow_free_references: U16,
    /// Slow ratchet window, in slots.
    pub slow_window_slots: U64,
    /// Owner of the only token account withdrawals of withheld fees may go to.
    #[cfg_attr(feature = "serde", serde(with = "As::<DisplayFromStr>"))]
    pub settler: Address,
    /// Withdraw authority `fee_destination` must carry, set by whoever initialized.
    #[cfg_attr(feature = "serde", serde(with = "As::<DisplayFromStr>"))]
    pub stake_withdrawer: Address,
    /// Earliest lockup epoch `fee_destination` may carry, set by whoever initialized.
    pub stake_lockup_epoch: U64,
    /// Transfers below this many tokens do not count on the fast ratchet: dust cannot
    /// raise anyone else's k. They still count, and pay, on the sender's own slow ratchet.
    pub min_reference_amount: U64,
    /// Slot the fast counter belongs to. Reset whenever the clock moves past it.
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

    fn schedule(floor: u16, cap: u16, free: u16, n: u64) -> u16 {
        if n <= u64::from(free) {
            return 0;
        }
        let raw = (floor as u128)
            .saturating_mul(n as u128)
            .saturating_mul(n as u128);
        cmp::min(raw, cmp::min(cap as u128, ONE_IN_BASIS_POINTS)) as u16
    }

    /// Fast ratchet: fee for the n-th reference to the mint in a slot.
    pub fn fee_basis_points(&self, n: u64) -> u16 {
        Self::schedule(
            u16::from(self.floor_basis_points),
            u16::from(self.cap_basis_points),
            u16::from(self.free_references),
            n,
        )
    }

    /// Slow ratchet: fee for an account's m-th reference in a window.
    pub fn slow_fee_basis_points(&self, m: u64) -> u16 {
        Self::schedule(
            u16::from(self.slow_floor_basis_points),
            u16::from(self.slow_cap_basis_points),
            u16::from(self.slow_free_references),
            m,
        )
    }

    /// What a reference pays: the larger of the two ratchets.
    pub fn combined_fee_basis_points(&self, n: u64, m: u64) -> u16 {
        cmp::max(self.fee_basis_points(n), self.slow_fee_basis_points(m))
    }

    /// Fee in tokens on `pre_fee_amount` for the fast ordinal `n` alone.
    pub fn calculate_fee(&self, pre_fee_amount: u64, n: u64) -> Option<u64> {
        self.calculate_fee_at(pre_fee_amount, self.fee_basis_points(n))
    }

    /// Fee in tokens on `pre_fee_amount` at `basis_points`, rounded up.
    pub fn calculate_fee_at(&self, pre_fee_amount: u64, basis_points: u16) -> Option<u64> {
        let basis_points = basis_points as u128;
        if basis_points == 0 || pre_fee_amount == 0 {
            return Some(0);
        }
        let numerator = (pre_fee_amount as u128).checked_mul(basis_points)?;
        let fee = Self::ceil_div(numerator, ONE_IN_BASIS_POINTS)?;
        fee.try_into().ok()
    }

    /// Whether `amount` is big enough to count on the fast ratchet.
    pub fn counts_globally(&self, amount: u64) -> bool {
        amount >= u64::from(self.min_reference_amount)
    }

    /// Count a reference to the mint in `current_slot` and return its ordinal.
    pub fn reference(&mut self, current_slot: u64) -> u64 {
        if u64::from(self.slot) != current_slot {
            self.slot = current_slot.into();
            self.count = 0u64.into();
        }
        let n = u64::from(self.count).saturating_add(1);
        self.count = n.into();
        n
    }
}

impl Extension for SlotReferenceFeeConfig {
    const TYPE: ExtensionType = ExtensionType::SlotReferenceFeeConfig;
}

/// Slot reference fee extension data for token accounts. Required on every
/// token account of a mint that carries `SlotReferenceFeeConfig`.
#[repr(C)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct SlotReferenceFeeAmount {
    /// Amount withheld during transfers, to be harvested to the mint
    pub withheld_amount: U64,
    /// Slow ratchet: the window this account last referenced the mint in
    pub window: U64,
    /// Slow ratchet: references by this account in that window
    pub count: U64,
}

impl SlotReferenceFeeAmount {
    /// Count a reference by this account in the window `current_slot` falls in
    /// and return its ordinal within the window.
    pub fn reference(&mut self, current_slot: u64, window_slots: u64) -> u64 {
        let window = current_slot / cmp::max(window_slots, 1);
        if u64::from(self.window) != window {
            self.window = window.into();
            self.count = 0u64.into();
        }
        let m = u64::from(self.count).saturating_add(1);
        self.count = m.into();
        m
    }

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

    fn config(floor: u16, cap: u16, free: u16) -> SlotReferenceFeeConfig {
        SlotReferenceFeeConfig {
            authority: None.try_into().unwrap(),
            fee_destination: Address::new_unique(),
            floor_basis_points: floor.into(),
            cap_basis_points: cap.into(),
            free_references: free.into(),
            slow_floor_basis_points: 2.into(),
            slow_cap_basis_points: 1_000.into(),
            slow_free_references: 1.into(),
            slow_window_slots: 1_280.into(),
            settler: Address::new_unique(),
            stake_withdrawer: Address::new_unique(),
            stake_lockup_epoch: 0.into(),
            min_reference_amount: 1_000.into(),
            slot: 0.into(),
            count: 0.into(),
            withheld_amount: 0.into(),
        }
    }

    #[test]
    fn schedule_is_quadratic_with_free_first_and_cap() {
        let c = config(10, 10_000, 1);
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
        let c = config(10, 500, 0);
        assert_eq!(c.fee_basis_points(1), 10);
        assert_eq!(c.fee_basis_points(7), 490);
        assert_eq!(c.fee_basis_points(8), 500);
    }

    #[test]
    fn fee_rounds_up_and_zero_cases() {
        let c = config(10, 10_000, 1);
        assert_eq!(c.calculate_fee(1_000_000, 1), Some(0));
        assert_eq!(c.calculate_fee(0, 2), Some(0));
        assert_eq!(c.calculate_fee(1_000_000, 2), Some(4_000));
        assert_eq!(c.calculate_fee(1, 2), Some(1)); // 0.4% of 1, rounded up
        assert_eq!(c.calculate_fee(1_000_000, 32), Some(1_000_000));
        assert_eq!(c.calculate_fee(u64::MAX, 32), Some(u64::MAX));
    }

    #[test]
    fn counter_resets_on_new_slot() {
        let mut c = config(10, 10_000, 1);
        assert_eq!(c.reference(100), 1);
        assert_eq!(c.reference(100), 2);
        assert_eq!(c.reference(100), 3);
        assert_eq!(c.reference(101), 1);
        assert_eq!(u64::from(c.slot), 101);
        assert_eq!(c.reference(101), 2);
    }

    #[test]
    fn slow_ratchet_and_the_larger_wins() {
        let c = config(10, 10_000, 2);
        assert_eq!(c.slow_fee_basis_points(1), 0);
        assert_eq!(c.slow_fee_basis_points(2), 8);
        assert_eq!(c.slow_fee_basis_points(3), 18);
        assert_eq!(c.slow_fee_basis_points(23), 1_000);
        // second in the slot is free on the fast ratchet, second in the window pays 8 bp on the slow
        assert_eq!(c.combined_fee_basis_points(2, 2), 8);
        // third in the slot: fast 90 bp beats slow 18 bp
        assert_eq!(c.combined_fee_basis_points(3, 3), 90);
        let mut a = SlotReferenceFeeAmount::default();
        assert_eq!(a.reference(100, 1_280), 1);
        assert_eq!(a.reference(1_000, 1_280), 2);
        assert_eq!(a.reference(1_280, 1_280), 1);
        assert_eq!(u64::from(a.window), 1);
    }

    #[test]
    fn dust_does_not_count_globally() {
        let c = config(10, 10_000, 2);
        assert!(!c.counts_globally(999));
        assert!(c.counts_globally(1_000));
    }

    #[test]
    fn stake_meta_parses_the_bincode_layout() {
        let mut data = [0u8; 200];
        data[0..4].copy_from_slice(&1u32.to_le_bytes());
        let withdrawer = Address::new_unique();
        data[44..76].copy_from_slice(withdrawer.as_ref());
        data[84..92].copy_from_slice(&900u64.to_le_bytes());
        let m = StakeMeta::parse(&data).unwrap();
        assert_eq!(m.withdrawer, withdrawer);
        assert_eq!(m.lockup_epoch, 900);
        data[0..4].copy_from_slice(&0u32.to_le_bytes());
        assert!(
            StakeMeta::parse(&data).is_none(),
            "uninitialized is not a destination"
        );
        assert!(StakeMeta::parse(&data[..50]).is_none());
    }
}
