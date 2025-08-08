//! Generates the zero-knowledge proofs required for a confidential transfer.
//!
//! A confidential transfer requires a composition of three distinct zero-knowledge proofs to ensure
//! correctness and security. This function orchestrates their generation.
//!
//! ## Protocol Flow and Proof Components
//!
//! 1.  **Encrypt Transfer Amount**: The transfer amount is split into low (16-bit) and high (32-bit)
//!     components. This is done to facilitate efficient decryption, which would otherwise require
//!     solving the discrete logarithm problem over the entire 64-bit range. Each component is
//!     encrypted as a grouped (twisted) ElGamal ciphertext with decryption handles for the source,
//!     destination, and an optional auditor.
//!
//! 2.  **Generate Proofs**: The sender then generates the following proofs in a specific logical order:
//!
//!     -   **Ciphertext Validity Proof (`BatchedGroupedCiphertext3HandlesValidityProofData`)**:
//!         This proof certifies that the grouped ElGamal ciphertexts for the transfer amount are
//!         well-formed (i.e., they are valid encryptions of the low and high bit components under
//!         the source, destination, and auditor keys).
//!
//!     -   **Range Proof (`BatchedRangeProofU128Data`)**:
//!         This proof ensures solvency and prevents the creation of tokens. It certifies that:
//!         1.  The sender's remaining balance is a non-negative 64-bit integer. This is ensures
//!             that `current_balance >= transfer_amount`.
//!         2.  The low and high components of the transfer amount are valid 16-bit and 32-bit
//!             integers, respectively.
//!
//!         A range proof can only be generated from a Pedersen commitment for which the prover
//!         knows the opening. However, a sender does not necessarily know the Pedersen opening
//!         for the ciphertext associated with the sender's remaining balance ciphertext. This
//!         this necessitates the ciphertext-commitment equality proof below.
//!
//!     -   **Ciphertext-Commitment Equality Proof (`CiphertextCommitmentEqualityProofData`)**:
//!         We require that the sender create a *new* Pedersen commitment to their known plaintext
//!         remaining balance. This equality proof then certifies that the homomorphically computed
//!         `new_balance_ciphertext` and the new Pedersen commitment encrypt/commit to the exact same
//!         value.
//!
//! These three proofs, when verified together, allow the on-chain program to securely process the
//! confidential transfer.

#[cfg(target_arch = "wasm32")]
use solana_zk_sdk::encryption::grouped_elgamal::GroupedElGamalCiphertext3Handles;
use {
    crate::{
        encryption::TransferAmountCiphertext, errors::TokenProofGenerationError,
        try_combine_lo_hi_ciphertexts, try_split_u64, CiphertextValidityProofWithAuditorCiphertext,
        REMAINING_BALANCE_BIT_LENGTH, TRANSFER_AMOUNT_HI_BITS, TRANSFER_AMOUNT_LO_BITS,
    },
    solana_zk_sdk::{
        encryption::{
            auth_encryption::{AeCiphertext, AeKey},
            elgamal::{ElGamalCiphertext, ElGamalKeypair, ElGamalPubkey},
            pedersen::Pedersen,
        },
        zk_elgamal_proof_program::proof_data::{
            BatchedGroupedCiphertext3HandlesValidityProofData, BatchedRangeProofU128Data,
            CiphertextCommitmentEqualityProofData, ZkProofData,
        },
    },
};

/// The padding bit length in range proofs that are used for a confidential
/// token transfer
const RANGE_PROOF_PADDING_BIT_LENGTH: usize = 16;

/// The proof data required for a confidential transfer instruction when the
/// mint is not extended for fees
pub struct TransferProofData {
    pub equality_proof_data: CiphertextCommitmentEqualityProofData,
    pub ciphertext_validity_proof_data_with_ciphertext:
        CiphertextValidityProofWithAuditorCiphertext,
    pub range_proof_data: BatchedRangeProofU128Data,
}

pub fn transfer_split_proof_data(
    current_available_balance: &ElGamalCiphertext,
    current_decryptable_available_balance: &AeCiphertext,
    transfer_amount: u64,
    source_elgamal_keypair: &ElGamalKeypair,
    aes_key: &AeKey,
    destination_elgamal_pubkey: &ElGamalPubkey,
    auditor_elgamal_pubkey: Option<&ElGamalPubkey>,
) -> Result<TransferProofData, TokenProofGenerationError> {
    let default_auditor_pubkey = ElGamalPubkey::default();
    let auditor_elgamal_pubkey = auditor_elgamal_pubkey.unwrap_or(&default_auditor_pubkey);

    // Split the transfer amount into the low and high bit components
    let (transfer_amount_lo, transfer_amount_hi) =
        try_split_u64(transfer_amount, TRANSFER_AMOUNT_LO_BITS)
            .ok_or(TokenProofGenerationError::IllegalAmountBitLength)?;

    // Encrypt the `lo` and `hi` transfer amounts
    let (transfer_amount_grouped_ciphertext_lo, transfer_amount_opening_lo) =
        TransferAmountCiphertext::new(
            transfer_amount_lo,
            source_elgamal_keypair.pubkey(),
            destination_elgamal_pubkey,
            auditor_elgamal_pubkey,
        );
    #[cfg(not(target_arch = "wasm32"))]
    let grouped_ciphertext_lo = transfer_amount_grouped_ciphertext_lo.0;
    #[cfg(target_arch = "wasm32")]
    let grouped_ciphertext_lo = GroupedElGamalCiphertext3Handles::encryption_with_u64(
        source_elgamal_keypair.pubkey(),
        destination_elgamal_pubkey,
        auditor_elgamal_pubkey,
        transfer_amount_lo,
        &transfer_amount_opening_lo,
    );

    let (transfer_amount_grouped_ciphertext_hi, transfer_amount_opening_hi) =
        TransferAmountCiphertext::new(
            transfer_amount_hi,
            source_elgamal_keypair.pubkey(),
            destination_elgamal_pubkey,
            auditor_elgamal_pubkey,
        );
    #[cfg(not(target_arch = "wasm32"))]
    let grouped_ciphertext_hi = transfer_amount_grouped_ciphertext_hi.0;
    #[cfg(target_arch = "wasm32")]
    let grouped_ciphertext_hi = GroupedElGamalCiphertext3Handles::encryption_with_u64(
        source_elgamal_keypair.pubkey(),
        destination_elgamal_pubkey,
        auditor_elgamal_pubkey,
        transfer_amount_hi,
        &transfer_amount_opening_hi,
    );

    // Decrypt the current available balance at the source
    let current_decrypted_available_balance = current_decryptable_available_balance
        .decrypt(aes_key)
        .ok_or(TokenProofGenerationError::IllegalAmountBitLength)?;

    // Compute the remaining balance at the source
    let new_decrypted_available_balance = current_decrypted_available_balance
        .checked_sub(transfer_amount)
        .ok_or(TokenProofGenerationError::NotEnoughFunds)?;

    // Create a new Pedersen commitment for the remaining balance at the source
    let (new_available_balance_commitment, new_source_opening) =
        Pedersen::new(new_decrypted_available_balance);

    // Compute the remaining balance at the source as ElGamal ciphertexts
    let transfer_amount_source_ciphertext_lo = transfer_amount_grouped_ciphertext_lo
        .0
        .to_elgamal_ciphertext(0)
        .unwrap();
    let transfer_amount_source_ciphertext_hi = transfer_amount_grouped_ciphertext_hi
        .0
        .to_elgamal_ciphertext(0)
        .unwrap();

    #[allow(clippy::arithmetic_side_effects)]
    let new_available_balance_ciphertext = current_available_balance
        - try_combine_lo_hi_ciphertexts(
            &transfer_amount_source_ciphertext_lo,
            &transfer_amount_source_ciphertext_hi,
            TRANSFER_AMOUNT_LO_BITS,
        )
        .ok_or(TokenProofGenerationError::IllegalAmountBitLength)?;

    // generate equality proof data
    let equality_proof_data = CiphertextCommitmentEqualityProofData::new(
        source_elgamal_keypair,
        &new_available_balance_ciphertext,
        &new_available_balance_commitment,
        &new_source_opening,
        new_decrypted_available_balance,
    )
    .map_err(TokenProofGenerationError::from)?;

    // generate ciphertext validity data
    let ciphertext_validity_proof_data = BatchedGroupedCiphertext3HandlesValidityProofData::new(
        source_elgamal_keypair.pubkey(),
        destination_elgamal_pubkey,
        auditor_elgamal_pubkey,
        &grouped_ciphertext_lo,
        &grouped_ciphertext_hi,
        transfer_amount_lo,
        transfer_amount_hi,
        &transfer_amount_opening_lo,
        &transfer_amount_opening_hi,
    )
    .map_err(TokenProofGenerationError::from)?;

    let transfer_amount_auditor_ciphertext_lo = ciphertext_validity_proof_data
        .context_data()
        .grouped_ciphertext_lo
        .try_extract_ciphertext(2)
        .map_err(|_| TokenProofGenerationError::CiphertextExtraction)?;

    let transfer_amount_auditor_ciphertext_hi = ciphertext_validity_proof_data
        .context_data()
        .grouped_ciphertext_hi
        .try_extract_ciphertext(2)
        .map_err(|_| TokenProofGenerationError::CiphertextExtraction)?;

    let ciphertext_validity_proof_data_with_ciphertext =
        CiphertextValidityProofWithAuditorCiphertext {
            proof_data: ciphertext_validity_proof_data,
            ciphertext_lo: transfer_amount_auditor_ciphertext_lo,
            ciphertext_hi: transfer_amount_auditor_ciphertext_hi,
        };

    // generate range proof data

    // the total bit lengths for the range proof must be a power-of-2
    // therefore, create a Pedersen commitment to 0 and use it as a dummy commitment to a 16-bit
    // value
    let (padding_commitment, padding_opening) = Pedersen::new(0_u64);
    let range_proof_data = BatchedRangeProofU128Data::new(
        vec![
            &new_available_balance_commitment,
            transfer_amount_grouped_ciphertext_lo.get_commitment(),
            transfer_amount_grouped_ciphertext_hi.get_commitment(),
            &padding_commitment,
        ],
        vec![
            new_decrypted_available_balance,
            transfer_amount_lo,
            transfer_amount_hi,
            0,
        ],
        vec![
            REMAINING_BALANCE_BIT_LENGTH,
            TRANSFER_AMOUNT_LO_BITS,
            TRANSFER_AMOUNT_HI_BITS,
            RANGE_PROOF_PADDING_BIT_LENGTH,
        ],
        vec![
            &new_source_opening,
            &transfer_amount_opening_lo,
            &transfer_amount_opening_hi,
            &padding_opening,
        ],
    )
    .map_err(TokenProofGenerationError::from)?;

    Ok(TransferProofData {
        equality_proof_data,
        ciphertext_validity_proof_data_with_ciphertext,
        range_proof_data,
    })
}
