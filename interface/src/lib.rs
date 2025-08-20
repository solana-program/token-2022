#![allow(clippy::arithmetic_side_effects)]
#![deny(missing_docs)]
#![cfg_attr(not(test), warn(unsafe_code))]

//! An ERC20-like Token program for the Solana blockchain

pub mod error;
pub mod extension;
pub mod generic_token_account;
pub mod instruction;
pub mod native_mint;
pub mod pod;
#[cfg(feature = "serde")]
pub mod serialization;
pub mod state;

// Export current sdk types for downstream users building with a different sdk
// version
pub use solana_zk_sdk;
use {
    solana_program_error::{ProgramError, ProgramResult},
    solana_pubkey::Pubkey,
};

solana_pubkey::declare_id!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/// Checks that the supplied program ID is correct for spl-token-2022
pub fn check_program_account(spl_token_program_id: &Pubkey) -> ProgramResult {
    if spl_token_program_id != &id() {
        return Err(ProgramError::IncorrectProgramId);
    }
    Ok(())
}

/// In-lined spl token program id to avoid a dependency
pub mod inline_spl_token {
    solana_pubkey::declare_id!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
}

/// Checks that the supplied program ID is correct for spl-token or
/// spl-token-2022
pub fn check_spl_token_program_account(spl_token_program_id: &Pubkey) -> ProgramResult {
    if spl_token_program_id != &id() && spl_token_program_id != &inline_spl_token::id() {
        return Err(ProgramError::IncorrectProgramId);
    }
    Ok(())
}

/// Trims a string number by removing excess zeroes or unneeded decimal point
fn trim_ui_amount_string(mut ui_amount: String, decimals: u8) -> String {
    if decimals > 0 {
        let zeros_trimmed = ui_amount.trim_end_matches('0');
        ui_amount = zeros_trimmed.trim_end_matches('.').to_string();
    }
    ui_amount
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inline_spl_token_program_id() {
        assert_eq!(inline_spl_token::id(), spl_token_interface::id());
    }
}
