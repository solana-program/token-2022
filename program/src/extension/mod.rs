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
/// Utility to reallocate token accounts
pub mod reallocate;
/// Scaled UI Amount extension
pub mod scaled_ui_amount;
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

pub use spl_token_2022_interface::extension::{
    alloc_and_serialize, alloc_and_serialize_variable_len_extension, set_account_type, AccountType,
    BaseState, BaseStateWithExtensions, BaseStateWithExtensionsMut, Extension, ExtensionType,
    Length, PodStateWithExtensions, PodStateWithExtensionsMut, StateWithExtensions,
    StateWithExtensionsMut, StateWithExtensionsOwned,
};
