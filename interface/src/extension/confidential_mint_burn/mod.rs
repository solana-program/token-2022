use {
    crate::{
        error::TokenError,
        extension::{Extension, ExtensionType},
    },
    bytemuck::{Pod, Zeroable},
    solana_program_error::ProgramResult,
    solana_zk_sdk::encryption::pod::{
        auth_encryption::PodAeCiphertext,
        elgamal::{PodElGamalCiphertext, PodElGamalPubkey},
    },
};

/// Confidential Mint-Burn Extension instructions
pub mod instruction;

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

impl ConfidentialMintBurn {
    /// Checks if the mint can be closed based on confidential supply state
    ///
    /// The check verifies that the encrypted supply is an identically zero
    /// ElGamal ciphertext. In case the encrypted supply is zero, but not
    /// an identically zero ciphertext, one must use the
    /// `RotateSupplyElGamalPubkey` to update the supply ciphertext to an
    /// identically zero ciphertext.
    pub fn closable(&self) -> ProgramResult {
        if self.confidential_supply == PodElGamalCiphertext::default() {
            Ok(())
        } else {
            Err(TokenError::MintHasSupply.into())
        }
    }
}
