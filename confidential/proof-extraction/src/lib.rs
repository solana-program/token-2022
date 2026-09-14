#![no_std]

use pinocchio::{error::ProgramError, AccountView};

extern crate alloc;

pub mod burn;
pub mod encryption;
pub mod errors;
pub mod instruction;
pub mod mint;
pub mod transfer;
pub mod transfer_with_fee;
pub mod withdraw;

/// Returns the next account in the iterator, or an error if there are no more
/// accounts.
#[inline(always)]
pub fn next_account_view<'account, I: Iterator<Item = &'account mut AccountView>>(
    iter: &mut I,
) -> Result<I::Item, ProgramError> {
    iter.next().ok_or(ProgramError::NotEnoughAccountKeys)
}
