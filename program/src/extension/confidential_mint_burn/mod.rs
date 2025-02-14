use {
    crate::extension::{Extension, ExtensionType},
    bytemuck::{Pod, Zeroable},
    solana_zk_sdk::encryption::pod::{
        auth_encryption::PodAeCiphertext,
        elgamal::{PodElGamalCiphertext, PodElGamalPubkey},
    },
};

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
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub struct ConfidentialMintBurn {
    /// The confidential supply of the mint (encrypted by `encryption_pubkey`)
    pub confidential_supply: PodElGamalCiphertext,
    /// The decryptable confidential supply of the mint
    pub decryptable_supply: PodAeCiphertext,
    /// The ElGamal pubkey used to encrypt the confidential supply
    pub supply_elgamal_pubkey: PodElGamalPubkey,
    /// The amount of burn amounts not yet aggregated into the confidential supply
    pub pending_burn: PodElGamalCiphertext,
}

impl Extension for ConfidentialMintBurn {
    const TYPE: ExtensionType = ExtensionType::ConfidentialMintBurn;
}
