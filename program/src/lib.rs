#![allow(clippy::arithmetic_side_effects)]
#![deny(missing_docs)]

//! An ERC20-like Token program for the Solana blockchain

pub mod error;
pub mod extension;
pub mod generic_token_account;
pub mod instruction;
pub mod native_mint;
pub mod offchain;
pub mod onchain;
pub mod pod;
pub mod pod_instruction;
pub mod processor;
pub mod state;

#[cfg(not(feature = "no-entrypoint"))]
mod entrypoint;

#[deprecated(
    since = "9.1.0",
    note = "Use spl_token_2022_interface instead and remove spl_token_2022 as a dependency"
)]
pub use spl_token_2022_interface::{check_id, check_program_account, id, ID};
use {
    solana_address::Address,
    solana_program_error::{ProgramError, ProgramResult},
    solana_sdk_ids::system_program,
    solana_zk_sdk_pod::encryption::elgamal::PodElGamalCiphertext,
    spl_token_2022_interface::error::TokenError,
};

/// Convert the UI representation of a token amount (using the decimals field
/// defined in its mint) to the raw amount
///
/// The scaling factor is computed in `f64`, so a mint with a large `decimals`
/// produces a large finite factor instead of overflowing: `10_usize.pow` panics
/// for `decimals >= 20` in debug builds and wraps in release builds, and
/// `decimals` is a `u8` that this program does not otherwise bound.
///
/// The result comes from a saturating `f64 as u64` cast, so inputs that cannot
/// be represented are clamped rather than reported: `NaN` and negative amounts
/// give `0`, and amounts at or above `u64::MAX` give `u64::MAX`. Use
/// [`try_ui_amount_to_amount`] to reject those inputs instead.
pub fn ui_amount_to_amount(ui_amount: f64, decimals: u8) -> u64 {
    (ui_amount * 10_f64.powi(decimals as i32)) as u64
}

/// Convert the UI representation of a token amount (using the decimals field
/// defined in its mint) to the raw amount, truncating towards zero
///
/// Returns [`ProgramError::InvalidArgument`] if the scaled amount is `NaN`,
/// negative, or outside the range of a `u64`. Note that `u64::MAX as f64`
/// rounds up to `2^64`, so the upper bound is checked inclusively: every `f64`
/// greater than or equal to it is out of range.
pub fn try_ui_amount_to_amount(ui_amount: f64, decimals: u8) -> Result<u64, ProgramError> {
    let amount = ui_amount * 10_f64.powi(decimals as i32);
    if amount.is_nan() || amount < 0.0 || amount >= (u64::MAX as f64) {
        Err(ProgramError::InvalidArgument)
    } else {
        Ok(amount.trunc() as u64)
    }
}

/// Convert a raw amount to its UI representation (using the decimals field
/// defined in its mint)
///
/// The scaling factor is computed in `f64` for the same reason as in
/// [`ui_amount_to_amount`].
///
/// The result is lossy. `f64` carries a 53-bit mantissa, so `u64::MAX` converts
/// to `2^64`, which is larger than `u64::MAX` itself. Dividing by a power of ten
/// is also inexact, so the round trip back through [`ui_amount_to_amount`] can
/// differ from the original amount well below `2^53`: for example
/// `8_284_236_165_268_877` at 10 decimals returns one larger. Use
/// [`amount_to_ui_amount_string`] where an exact decimal rendering is required;
/// it is computed with integer arithmetic.
pub fn amount_to_ui_amount(amount: u64, decimals: u8) -> f64 {
    amount as f64 / 10_f64.powi(decimals as i32)
}

/// Convert a raw amount to its UI representation (using the decimals field
/// defined in its mint)
pub fn amount_to_ui_amount_string(amount: u64, decimals: u8) -> String {
    let decimals = decimals as usize;
    if decimals > 0 {
        // Left-pad zeros to decimals + 1, so we at least have an integer zero
        let mut s = format!("{:01$}", amount, decimals + 1);
        // Add the decimal point (Sorry, "," locales!)
        s.insert(s.len() - decimals, '.');
        s
    } else {
        amount.to_string()
    }
}

/// Convert a raw amount to its UI representation using the given decimals field
/// Excess zeroes or unneeded decimal point are trimmed.
pub fn amount_to_ui_amount_string_trimmed(amount: u64, decimals: u8) -> String {
    let s = amount_to_ui_amount_string(amount, decimals);
    trim_ui_amount_string(s, decimals)
}

/// Trims a string number by removing excess zeroes or unneeded decimal point
fn trim_ui_amount_string(mut ui_amount: String, decimals: u8) -> String {
    if decimals > 0 {
        let zeros_trimmed = ui_amount.trim_end_matches('0');
        ui_amount = zeros_trimmed.trim_end_matches('.').to_string();
    }
    ui_amount
}

/// Try to convert a UI representation of a token amount to its raw amount using
/// the given decimals field
pub fn try_ui_amount_into_amount(ui_amount: String, decimals: u8) -> Result<u64, ProgramError> {
    let decimals = decimals as usize;
    let mut parts = ui_amount.split('.');
    // splitting a string, even an empty one, will always yield an iterator of at
    // least length == 1
    let mut amount_str = parts.next().unwrap().to_string();
    let after_decimal = parts.next().unwrap_or("");
    let after_decimal = after_decimal.trim_end_matches('0');
    if (amount_str.is_empty() && after_decimal.is_empty())
        || parts.next().is_some()
        || after_decimal.len() > decimals
    {
        return Err(ProgramError::InvalidArgument);
    }

    amount_str.push_str(after_decimal);
    for _ in 0..decimals.saturating_sub(after_decimal.len()) {
        amount_str.push('0');
    }
    amount_str
        .parse::<u64>()
        .map_err(|_| ProgramError::InvalidArgument)
}

/// Checks that the supplied program ID is correct for the ZK ElGamal proof
/// program
pub fn check_zk_elgamal_proof_program_account(
    zk_elgamal_proof_program_id: &Address,
) -> ProgramResult {
    if zk_elgamal_proof_program_id != &solana_zk_elgamal_proof_interface::id() {
        return Err(ProgramError::IncorrectProgramId);
    }
    Ok(())
}

/// Checks if the supplied program ID is that of the system program
pub fn check_system_program_account(system_program_id: &Address) -> ProgramResult {
    if system_program_id != &system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }
    Ok(())
}

/// Checks if the supplied program ID is that of the ElGamal registry program
pub(crate) fn check_elgamal_registry_program_account(
    elgamal_registry_account_program_id: &Address,
) -> ProgramResult {
    if elgamal_registry_account_program_id != &spl_elgamal_registry_interface::id() {
        return Err(ProgramError::IncorrectProgramId);
    }
    Ok(())
}

/// Check instruction data and proof data auditor ciphertext consistency
pub(crate) fn check_auditor_ciphertext(
    instruction_data_auditor_ciphertext_lo: &PodElGamalCiphertext,
    instruction_data_auditor_ciphertext_hi: &PodElGamalCiphertext,
    proof_context_auditor_ciphertext_lo: &PodElGamalCiphertext,
    proof_context_auditor_ciphertext_hi: &PodElGamalCiphertext,
) -> ProgramResult {
    if instruction_data_auditor_ciphertext_lo != proof_context_auditor_ciphertext_lo {
        return Err(TokenError::ConfidentialTransferBalanceMismatch.into());
    }
    if instruction_data_auditor_ciphertext_hi != proof_context_auditor_ciphertext_hi {
        return Err(TokenError::ConfidentialTransferBalanceMismatch.into());
    }
    Ok(())
}

#[cfg(test)]
mod ui_amount_tests {
    use {super::*, proptest::prelude::*};

    /// `10_usize.pow(decimals)` overflows for `decimals >= 20`; `decimals` is a
    /// `u8` that this program does not bound, so the conversion must stay
    /// finite rather than panic in debug or wrap in release.
    #[test]
    fn large_decimals_do_not_panic() {
        for decimals in [19u8, 20, 38, 255] {
            assert_eq!(ui_amount_to_amount(0.0, decimals), 0);
            assert!(amount_to_ui_amount(1, decimals).is_finite());
            assert_eq!(try_ui_amount_to_amount(0.0, decimals), Ok(0));
        }
    }

    #[test]
    fn try_conversion_rejects_unrepresentable_input() {
        assert_eq!(
            try_ui_amount_to_amount(f64::NAN, 6),
            Err(ProgramError::InvalidArgument)
        );
        assert_eq!(
            try_ui_amount_to_amount(-1.0, 6),
            Err(ProgramError::InvalidArgument)
        );
        assert_eq!(
            try_ui_amount_to_amount(f64::INFINITY, 0),
            Err(ProgramError::InvalidArgument)
        );
        assert_eq!(
            try_ui_amount_to_amount(1e30, 6),
            Err(ProgramError::InvalidArgument)
        );
    }

    /// `u64::MAX as f64` rounds up to `2^64`, so the bound is inclusive: an
    /// amount of exactly `2^64` is out of range and must be rejected, not
    /// silently saturated to `u64::MAX`.
    #[test]
    fn upper_bound_is_inclusive() {
        assert_eq!(
            try_ui_amount_to_amount(u64::MAX as f64, 0),
            Err(ProgramError::InvalidArgument)
        );
        let below = f64::from_bits((u64::MAX as f64).to_bits() - 1);
        assert!(try_ui_amount_to_amount(below, 0).is_ok());
    }

    /// The infallible helper keeps its saturating contract, which the doc
    /// comment now states explicitly.
    #[test]
    fn infallible_conversion_saturates() {
        assert_eq!(ui_amount_to_amount(f64::NAN, 6), 0);
        assert_eq!(ui_amount_to_amount(-1.0, 6), 0);
        assert_eq!(ui_amount_to_amount(1e30, 6), u64::MAX);
    }

    #[test]
    fn string_conversion_is_exact_where_f64_is_not() {
        // 2^53 + 1 is not representable in f64, but the string path is integer
        // arithmetic and stays exact.
        let amount = (1u64 << 53) + 1;
        assert_eq!(amount_to_ui_amount(amount, 0) as u64, amount - 1);
        assert_eq!(amount_to_ui_amount_string(amount, 0), amount.to_string());
    }

    /// The `f64` round trip is lossy well below the 53-bit mantissa limit,
    /// because dividing by a power of ten is itself inexact. This amount is
    /// smaller than `2^53` and still comes back one larger.
    #[test]
    fn f64_round_trip_is_lossy_below_mantissa_limit() {
        let amount = 8_284_236_165_268_877u64;
        assert!(amount < (1u64 << 53));
        let ui = amount_to_ui_amount(amount, 10);
        assert_eq!(try_ui_amount_to_amount(ui, 10), Ok(amount + 1));
    }

    proptest! {
        /// The string path is integer arithmetic, so it round-trips exactly
        /// where the `f64` path does not.
        #[test]
        fn string_round_trip_is_exact(
            amount in 0u64..u64::MAX,
            decimals in 0u8..=18,
        ) {
            let ui = amount_to_ui_amount_string(amount, decimals);
            prop_assert_eq!(try_ui_amount_into_amount(ui, decimals), Ok(amount));
        }

        /// The fallible helper never panics, whatever it is handed.
        #[test]
        fn try_conversion_never_panics(ui_amount: f64, decimals: u8) {
            let _ = try_ui_amount_to_amount(ui_amount, decimals);
        }
    }
}
