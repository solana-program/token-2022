/// Confidential transfer fee extension instructions
pub mod instruction;

/// Confidential transfer fee extension processor
pub mod processor;

/// Confidential Transfer Fee extension account information needed for
/// instructions
#[cfg(not(target_os = "solana"))]
pub mod account_info;

pub use spl_token_2022_interface::extension::confidential_transfer_fee::{
    ConfidentialTransferFeeAmount, ConfidentialTransferFeeConfig, EncryptedFee,
    EncryptedWithheldAmount,
};
