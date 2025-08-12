//! Generates the zero-knowledge proofs required for a confidential withdraw.
//!
//! A confidential withdraw operation converts a user's encrypted, confidential token balance back into a
//! standard, publicly-visible SPL token balance. To ensure this operation is valid and that a user
//! cannot create tokens out of thin air, it requires two distinct zero-knowledge proofs.
//!
//! ## Protocol Flow and Proof Components
//!
//! 1.  **Calculate Remaining Balance**: The client first calculates the remaining confidential balance
//!     by subtracting the desired `withdraw_amount` from their current known balance.
//!
//! 2.  **Homomorphic Calculation**: The client homomorphically computes the new encrypted balance
//!     ciphertext. This is done by taking the current `available_balance` ciphertext and subtracting
//!     a newly-encoded ciphertext of the `withdraw_amount`.
//!
//! 3.  **Generate Proofs**: The user generates two proofs to certify the validity of the operation:
//!
//!     -   **Ciphertext-Commitment Equality Proof (`CiphertextCommitmentEqualityProofData`)**:
//!         This proof provides a cryptographic link that enables the solvency check. When the
//!         `remaining_balance_ciphertext` is computed homomorphically, the prover may not know the
//!         corresponding Pedersen opening (randomness) for the resulting ciphertext. Performing a
//!         range proof requires knowledge of this opening.
//!
//!         To solve this, the prover creates a *new* Pedersen commitment for the remaining balance,
//!         for which it knows the opening. The equality proof then certifies that the
//!         homomorphically-derived ciphertext and this new commitment hide the exact same numerical
//!         value. This allows the range proof to be performed on the new commitment.
//!
//!     -   **Range Proof (`BatchedRangeProofU64Data`)**:
//!         This proof certifies the user's **solvency**. By proving that the value inside the
//!         Pedersen commitment for the *remaining balance* is non-negative (i.e., it is in the range
//!         `[0, 2^64)`), it implicitly proves that the user's original balance was greater than or
//!         equal to the `withdraw_amount`.

use {
    crate::errors::TokenProofGenerationError,
    solana_zk_sdk::{
        encryption::{
            elgamal::{ElGamal, ElGamalCiphertext, ElGamalKeypair},
            pedersen::Pedersen,
        },
        zk_elgamal_proof_program::proof_data::{
            BatchedRangeProofU64Data, CiphertextCommitmentEqualityProofData,
        },
    },
};

const REMAINING_BALANCE_BIT_LENGTH: usize = 64;

/// Proof data required for a withdraw instruction
pub struct WithdrawProofData {
    pub equality_proof_data: CiphertextCommitmentEqualityProofData,
    pub range_proof_data: BatchedRangeProofU64Data,
}

pub fn withdraw_proof_data(
    current_available_balance: &ElGamalCiphertext,
    current_balance: u64,
    withdraw_amount: u64,
    elgamal_keypair: &ElGamalKeypair,
) -> Result<WithdrawProofData, TokenProofGenerationError> {
    // Calculate the remaining balance after withdraw
    let remaining_balance = current_balance
        .checked_sub(withdraw_amount)
        .ok_or(TokenProofGenerationError::NotEnoughFunds)?;

    // Generate a Pedersen commitment for the remaining balance
    let (remaining_balance_commitment, remaining_balance_opening) =
        Pedersen::new(remaining_balance);

    // Compute the remaining balance ciphertext
    #[allow(clippy::arithmetic_side_effects)]
    let remaining_balance_ciphertext = current_available_balance - ElGamal::encode(withdraw_amount);

    // Generate proof data
    let equality_proof_data = CiphertextCommitmentEqualityProofData::new(
        elgamal_keypair,
        &remaining_balance_ciphertext,
        &remaining_balance_commitment,
        &remaining_balance_opening,
        remaining_balance,
    )
    .map_err(TokenProofGenerationError::from)?;

    let range_proof_data = BatchedRangeProofU64Data::new(
        vec![&remaining_balance_commitment],
        vec![remaining_balance],
        vec![REMAINING_BALANCE_BIT_LENGTH],
        vec![&remaining_balance_opening],
    )
    .map_err(TokenProofGenerationError::from)?;

    Ok(WithdrawProofData {
        equality_proof_data,
        range_proof_data,
    })
}
