use {
    crate::{
        extension::{
            BaseState, BaseStateWithExtensions, BaseStateWithExtensionsMut, Extension,
            ExtensionType, PodStateWithExtensionsMut,
        },
        pod::PodAccount,
    },
    bytemuck::{Pod, Zeroable},
    solana_account_info::AccountInfo,
    solana_address::Address,
    solana_nullable::MaybeNull,
    solana_program_error::ProgramError,
    solana_zero_copy::unaligned::Bool,
};
#[cfg(feature = "serde")]
use {
    serde::{Deserialize, Serialize},
    serde_with::{As, DisplayFromStr},
};

/// Instructions for the `TransferHook` extension
pub mod instruction;

/// Transfer hook extension data for mints.
#[repr(C)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct TransferHook {
    /// Authority that can set the transfer hook program id
    #[cfg_attr(feature = "serde", serde(with = "As::<Option<DisplayFromStr>>"))]
    pub authority: MaybeNull<Address>,
    /// Program that authorizes the transfer
    #[cfg_attr(feature = "serde", serde(with = "As::<Option<DisplayFromStr>>"))]
    pub program_id: MaybeNull<Address>,
}

/// Indicates that the tokens from this account belong to a mint with a transfer
/// hook
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
#[repr(transparent)]
pub struct TransferHookAccount {
    /// Flag to indicate that the account is in the middle of a transfer
    pub transferring: Bool,
}

impl Extension for TransferHook {
    const TYPE: ExtensionType = ExtensionType::TransferHook;
}

impl Extension for TransferHookAccount {
    const TYPE: ExtensionType = ExtensionType::TransferHookAccount;
}

/// Attempts to get the transfer hook program id from the TLV data, returning
/// None if the extension is not found
pub fn get_program_id<S: BaseState, BSE: BaseStateWithExtensions<S>>(
    state: &BSE,
) -> Option<Address> {
    state
        .get_extension::<TransferHook>()
        .ok()
        .and_then(|e| Option::<Address>::from(e.program_id))
}

/// Helper function to set the transferring flag before calling into transfer
/// hook
pub fn set_transferring<BSE: BaseStateWithExtensionsMut<S>, S: BaseState>(
    account: &mut BSE,
) -> Result<(), ProgramError> {
    let account_extension = account.get_extension_mut::<TransferHookAccount>()?;
    account_extension.transferring = true.into();
    Ok(())
}

/// Helper function to unset the transferring flag after a transfer
pub fn unset_transferring(account_info: &AccountInfo) -> Result<(), ProgramError> {
    let mut account_data = account_info.data.borrow_mut();
    let mut account = PodStateWithExtensionsMut::<PodAccount>::unpack(&mut account_data)?;
    let account_extension = account.get_extension_mut::<TransferHookAccount>()?;
    account_extension.transferring = false.into();
    Ok(())
}
