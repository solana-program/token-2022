//! State transition types
#![deprecated(
    since = "9.1.0",
    note = "Use spl_token_2022_interface instead and remove spl_token_2022 as a dependency"
)]
use pinocchio::AccountView;
use solana_program_error::ProgramError;
pub use spl_token_2022_interface::state::*;
use spl_token_2022_interface::{
    extension::{
        transfer_hook::TransferHookAccount, BaseStateWithExtensionsMut, PodStateWithExtensionsMut,
    },
    pod::PodAccount,
};

/// Helper function to unset the transferring flag after a transfer
pub fn unset_transferring(account_info: &mut AccountView) -> Result<(), ProgramError> {
    let mut account_data = account_info.try_borrow_mut()?;
    let mut account = PodStateWithExtensionsMut::<PodAccount>::unpack(&mut account_data)?;
    let account_extension = account.get_extension_mut::<TransferHookAccount>()?;
    account_extension.transferring = false.into();
    Ok(())
}
