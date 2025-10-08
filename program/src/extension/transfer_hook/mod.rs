/// Instructions for the `TransferHook` extension
pub mod instruction;

/// Instruction processor for the `TransferHook` extension
pub mod processor;

#[deprecated(
    since = "9.1.0",
    note = "Use spl_token_2022_interface instead and remove spl_token_2022 as a dependency"
)]
pub use spl_token_2022_interface::extension::transfer_hook::{
    get_program_id, set_transferring, unset_transferring, TransferHook, TransferHookAccount,
};
