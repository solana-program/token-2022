/// Maximum bit length of any deposit or transfer amount
///
/// Any deposit or transfer amount must be less than `2^48`
pub use spl_token_2022_interface::extension::confidential_transfer::{
    ConfidentialTransferAccount, ConfidentialTransferMint, DecryptableBalance, EncryptedBalance,
    DEFAULT_MAXIMUM_PENDING_BALANCE_CREDIT_COUNTER, MAXIMUM_DEPOSIT_TRANSFER_AMOUNT,
    PENDING_BALANCE_LO_BIT_LENGTH,
};

/// Confidential Transfer Extension instructions
pub mod instruction;

/// Confidential Transfer Extension processor
pub mod processor;

/// Helper functions to verify zero-knowledge proofs in the Confidential
/// Transfer Extension
pub mod verify_proof;

/// Confidential Transfer Extension account information needed for instructions
#[cfg(not(target_os = "solana"))]
pub mod account_info;
