//! Extensions available to token mints and accounts

/// Confidential Transfer extension
pub mod confidential_transfer;
/// Confidential Transfer Fee extension
pub mod confidential_transfer_fee;
/// CPI Guard extension
pub mod cpi_guard;
/// Default Account State extension
pub mod default_account_state;
/// Group Member Pointer extension
pub mod group_member_pointer;
/// Group Pointer extension
pub mod group_pointer;
/// Immutable Owner extension
pub mod immutable_owner;
/// Interest-Bearing Mint extension
pub mod interest_bearing_mint;
/// Memo Transfer extension
pub mod memo_transfer;
/// Metadata Pointer extension
pub mod metadata_pointer;
/// Mint Close Authority extension
pub mod mint_close_authority;
/// Non Transferable extension
pub mod non_transferable;
/// Pausable extension
pub mod pausable;
/// Permanent Delegate extension
pub mod permanent_delegate;
/// Permissioned burn extension
pub mod permissioned_burn;
/// Utility to reallocate token accounts
pub mod reallocate;
/// Scaled UI Amount extension
pub mod scaled_ui_amount;
/// Slot reference fee extension
pub mod slot_reference_fee;
/// Token-group extension
pub mod token_group;
/// Token-metadata extension
pub mod token_metadata;
/// Transfer Fee extension
pub mod transfer_fee;
/// Transfer Hook extension
pub mod transfer_hook;

/// Confidential mint-burn extension
pub mod confidential_mint_burn;

use pinocchio::AccountView;
use solana_program_error::ProgramError;
#[deprecated(
    since = "9.1.0",
    note = "Use spl_token_2022_interface instead and remove spl_token_2022 as a dependency"
)]
pub use spl_token_2022_interface::extension::{
    alloc_and_serialize, alloc_and_serialize_variable_len_extension, set_account_type, AccountType,
    BaseState, BaseStateWithExtensions, BaseStateWithExtensionsMut, Extension, ExtensionType,
    Length, PodStateWithExtensions, PodStateWithExtensionsMut, StateWithExtensions,
    StateWithExtensionsMut, StateWithExtensionsOwned,
};
use spl_token_2022_interface::{extension::transfer_hook::TransferHookAccount, pod::PodAccount};

/// Helper function to unset the transferring flag after a transfer
pub(crate) fn unset_transferring(account_info: &mut AccountView) -> Result<(), ProgramError> {
    let mut account_data = account_info.try_borrow_mut()?;
    let mut account = PodStateWithExtensionsMut::<PodAccount>::unpack(&mut account_data)?;
    let account_extension = account.get_extension_mut::<TransferHookAccount>()?;
    account_extension.transferring = false.into();
    Ok(())
}
