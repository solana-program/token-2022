/// Confidential Mint-Burn Extension instructions
pub mod instruction;

/// Confidential Mint-Burn Extension processor
pub mod processor;

/// Confidential Mint-Burn proof verification
pub mod verify_proof;

/// Confidential Mint Burn Extension supply information needed for instructions
#[cfg(not(target_os = "solana"))]
pub mod account_info;

/// Confidential mint-burn mint configuration
pub use spl_token_2022_interface::extension::confidential_mint_burn::ConfidentialMintBurn;
