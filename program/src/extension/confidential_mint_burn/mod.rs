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
#[deprecated(
    since = "9.1.0",
    note = "Use spl_token_2022_interface instead and remove spl_token_2022 as a dependency"
)]
pub use spl_token_2022_interface::extension::confidential_mint_burn::ConfidentialMintBurn;
