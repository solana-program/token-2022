/// Confidential transfer fee extension instructions
pub mod instruction;

/// Confidential transfer fee extension processor
pub mod processor;

/// Confidential Transfer Fee extension account information needed for
/// instructions
#[cfg(not(target_os = "solana"))]
pub mod account_info;

#[deprecated(
    since = "9.1.0",
    note = "Use spl_token_2022_interface instead and remove spl_token_2022 as a dependency"
)]
pub use spl_token_2022_interface::extension::confidential_transfer_fee::{
    ConfidentialTransferFeeAmount, ConfidentialTransferFeeConfig, EncryptedFee,
    EncryptedWithheldAmount,
};
