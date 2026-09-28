use {
    crate::{
        error::TokenError,
        extension::{Extension, ExtensionType},
    },
    bytemuck::{Pod, Zeroable},
    solana_program_error::ProgramResult,
    solana_zk_sdk_pod::encryption::{
        auth_encryption::PodAeCiphertext,
        elgamal::{PodElGamalCiphertext, PodElGamalPubkey},
    },
};

/// Confidential Mint-Burn Extension instructions
pub mod instruction;

/// Confidential mint-burn mint configuration.
///
/// # Supply reconciliation
///
/// `decryptable_supply` is an AES-encrypted cache for the mint
/// authority's convenience. The program does not verify that it encrypts the
/// same value as `confidential_supply`.
///
/// `ApplyPendingBurn` subtracts the pending burns from `confidential_supply`
/// and clears `pending_burn`, but leaves `decryptable_supply` unchanged.
/// Callers do not need to submit a separate `UpdateDecryptableSupply` after
/// every `ApplyPendingBurn`. Instead, clients can recover the current supply
/// locally before generating mint or supply key rotation proofs:
///
/// 1. AES-decrypt `decryptable_supply` to obtain `cached_supply`.
/// 2. Encrypt `cached_supply` under `supply_elgamal_pubkey` to obtain
///    `Enc(cached_supply)`.
/// 3. Homomorphically subtract `confidential_supply` from
///    `Enc(cached_supply)`.
/// 4. Decrypt this difference with the supply ElGamal secret key to obtain
///    `applied_burns`.
/// 5. Compute `current_supply = cached_supply - applied_burns`.
///
/// When the cache was last set to the correct supply, this difference is the
/// total burns applied since that update. Decrypting differences of up to
/// about 40 bits is practical with a suitable discrete-log search, even when
/// the full supply is a `u64`. Larger differences become increasingly expensive
/// to decrypt and can make direct recovery impractical. In that case, clients
/// can recover `applied_burns` by decrypting individual burns from transaction
/// history.
///
/// Individual burn proofs split amounts into 16-bit low and 32-bit high
/// ciphertexts, but the program combines them into a single `pending_burn`
/// ciphertext. The mint state does not retain separate low/high ciphertexts
/// for decoding.
///
/// Submitting `ApplyPendingBurn` regularly limits the amount accumulating in
/// `pending_burn`. Periodically refreshing the supply cache with the reconciled
/// value also keeps `applied_burns` small and reduces decryption overhead.
///
/// For a mint, the client AES-encrypts `current_supply + mint_amount`
/// into `MintInstructionData::new_decryptable_supply`. A successful `Mint`
/// stores that value, refreshing the cache without a separate
/// `UpdateDecryptableSupply`. Supply key rotation leaves the cache unchanged.
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub struct ConfidentialMintBurn {
    /// The confidential supply of the mint, encrypted by `supply_elgamal_pubkey`.
    pub confidential_supply: PodElGamalCiphertext,
    /// An unverified, AES-encrypted cache of the confidential supply.
    ///
    /// This can lag behind applied burns. See the supply reconciliation
    /// description on `ConfidentialMintBurn` for how clients recover the current
    /// supply.
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
