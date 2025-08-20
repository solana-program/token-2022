//! Generates the zero-knowledge proofs required for a confidential transfer with a fee.
//!
//! A confidential transfer with a fee is more complex than a simple transfer. It requires five
//! distinct zero-knowledge proofs to ensure the validity of the transfer, the solvency of the
//! sender, and the correctness of the fee amount according to the on-chain mint configuration.
//!
//! ## Protocol Flow and Proof Components
//!
//! 1.  **Fee Calculation**: The client first calculates the required fee based on the transfer
//!     amount and the on-chain fee parameters (rate and maximum cap).
//!
//! 2.  **Encrypt Amounts**: The gross transfer amount and the fee amount are each split into low
//!     and high bit components. These components are then encrypted into separate grouped (twisted)
//!     ElGamal ciphertexts with the appropriate decryption handles for the involved parties (source,
//!     destination, auditor, and withdraw authority).
//!
//! 3.  **Generate Proofs**: The sender generates five proofs that work in concert:
//!
//!     -   **Transfer Amount Ciphertext Validity Proof
//!         (`BatchedGroupedCiphertext3HandlesValidityProofData`)**: Certifies that the grouped
//!         ElGamal ciphertext for the gross transfer amount is well-formed.
//!
//!     -   **Fee Ciphertext Validity Proof
//!         (`BatchedGroupedCiphertext2HandlesValidityProofData`)**: Certifies that the grouped
//!         ElGamal ciphertext for the transfer fee is well-formed.
//!
//!     -   **Fee Calculation Proof (`PercentageWithCapProofData`)**:
//!         It's a "one-of-two" proof that certifies **either**:
//!           1. The `fee_amount` is exactly equal to the on-chain `maximum_fee`.
//!           2. The `fee_amount` was correctly calculated as a percentage of the
//!              `transfer_amount`, according to the on-chain `fee_rate_basis_points`.
//!
//!         **Note**: The proof certifies that the transfer fee is a valid percentage of the
//!         transfer amount or that the fee is exactly the maximum fee. While the sender is
//!         expected to choose the lower of these two options, the proof does not enforce this
//!         choice.
//!
//!     -   **Range Proof (`BatchedRangeProofU256Data`)**:
//!         This expanded range proof ensures the solvency of the entire transaction by certifying
//!         that all critical monetary values are non-negative. This includes the sender's remaining
//!         balance, the gross transfer amount, the fee amount, and the net transfer amount that the
//!         destination receives.
//!
//!     -   **Ciphertext-Commitment Equality Proof (`CiphertextCommitmentEqualityProofData`)**:
//!         Identical in purpose to the simple transfer, this proof links the sender's remaining
//!         balance (as a homomorphically computed ElGamal ciphertext) to a new Pedersen commitment.
//!         This commitment is then used in the Range Proof to prove the sender's solvency.

#[cfg(not(target_arch = "wasm32"))]
use solana_zk_sdk::encryption::grouped_elgamal::GroupedElGamal;
#[cfg(target_arch = "wasm32")]
use solana_zk_sdk::encryption::grouped_elgamal::{
    GroupedElGamalCiphertext2Handles, GroupedElGamalCiphertext3Handles,
};
use {
    crate::{
        encryption::{FeeCiphertext, TransferAmountCiphertext},
        errors::TokenProofGenerationError,
        try_combine_lo_hi_ciphertexts, try_combine_lo_hi_commitments, try_combine_lo_hi_openings,
        try_split_u64, CiphertextValidityProofWithAuditorCiphertext, TRANSFER_AMOUNT_HI_BITS,
        TRANSFER_AMOUNT_LO_BITS,
    },
    curve25519_dalek::scalar::Scalar,
    solana_zk_sdk::{
        encryption::{
            auth_encryption::{AeCiphertext, AeKey},
            elgamal::{ElGamalCiphertext, ElGamalKeypair, ElGamalPubkey},
            pedersen::{Pedersen, PedersenCommitment, PedersenOpening},
        },
        zk_elgamal_proof_program::proof_data::{
            BatchedGroupedCiphertext2HandlesValidityProofData,
            BatchedGroupedCiphertext3HandlesValidityProofData, BatchedRangeProofU256Data,
            CiphertextCommitmentEqualityProofData, PercentageWithCapProofData, ZkProofData,
        },
    },
};

const MAX_FEE_BASIS_POINTS_SUB_ONE: u64 = 9_999;
const MAX_FEE_BASIS_POINTS: u64 = 10_000;
const ONE_IN_BASIS_POINTS: u128 = MAX_FEE_BASIS_POINTS as u128;

const FEE_AMOUNT_LO_BITS: usize = 16;
const FEE_AMOUNT_HI_BITS: usize = 32;

const REMAINING_BALANCE_BIT_LENGTH: usize = 64;
const DELTA_BIT_LENGTH: usize = 16;
const NET_TRANSFER_AMOUNT_BIT_LENGTH: usize = 64;

/// The proof data required for a confidential transfer instruction when the
/// mint is extended for fees
pub struct TransferWithFeeProofData {
    pub equality_proof_data: CiphertextCommitmentEqualityProofData,
    pub transfer_amount_ciphertext_validity_proof_data_with_ciphertext:
        CiphertextValidityProofWithAuditorCiphertext,
    pub percentage_with_cap_proof_data: PercentageWithCapProofData,
    pub fee_ciphertext_validity_proof_data: BatchedGroupedCiphertext2HandlesValidityProofData,
    pub range_proof_data: BatchedRangeProofU256Data,
}

#[allow(clippy::too_many_arguments)]
pub fn transfer_with_fee_split_proof_data(
    current_available_balance: &ElGamalCiphertext,
    current_decryptable_available_balance: &AeCiphertext,
    transfer_amount: u64,
    source_elgamal_keypair: &ElGamalKeypair,
    aes_key: &AeKey,
    destination_elgamal_pubkey: &ElGamalPubkey,
    auditor_elgamal_pubkey: Option<&ElGamalPubkey>,
    withdraw_withheld_authority_elgamal_pubkey: &ElGamalPubkey,
    fee_rate_basis_points: u16,
    maximum_fee: u64,
) -> Result<TransferWithFeeProofData, TokenProofGenerationError> {
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
    let grouped_ciphertext_lo = GroupedElGamalCiphertext3Handles::encrypt_with_u64(
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
    let grouped_ciphertext_hi = GroupedElGamalCiphertext3Handles::encrypt_with_u64(
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
    let transfer_amount_ciphertext_validity_proof_data =
        BatchedGroupedCiphertext3HandlesValidityProofData::new(
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

    let transfer_amount_auditor_ciphertext_lo = transfer_amount_ciphertext_validity_proof_data
        .context_data()
        .grouped_ciphertext_lo
        .try_extract_ciphertext(2)
        .map_err(|_| TokenProofGenerationError::CiphertextExtraction)?;

    let transfer_amount_auditor_ciphertext_hi = transfer_amount_ciphertext_validity_proof_data
        .context_data()
        .grouped_ciphertext_hi
        .try_extract_ciphertext(2)
        .map_err(|_| TokenProofGenerationError::CiphertextExtraction)?;

    let transfer_amount_ciphertext_validity_proof_data_with_ciphertext =
        CiphertextValidityProofWithAuditorCiphertext {
            proof_data: transfer_amount_ciphertext_validity_proof_data,
            ciphertext_lo: transfer_amount_auditor_ciphertext_lo,
            ciphertext_hi: transfer_amount_auditor_ciphertext_hi,
        };

    // calculate fee
    let transfer_fee_basis_points = fee_rate_basis_points;
    let transfer_fee_maximum_fee = maximum_fee;
    let (raw_fee_amount, raw_delta_fee) = calculate_fee(transfer_amount, transfer_fee_basis_points)
        .ok_or(TokenProofGenerationError::FeeCalculation)?;

    // if raw fee is greater than the maximum fee, then use the maximum fee for the
    // fee amount and set the claimed delta fee to be 0 for simplicity
    let (fee_amount, claimed_delta_fee) = if transfer_fee_maximum_fee < raw_fee_amount {
        (transfer_fee_maximum_fee, 0)
    } else {
        (raw_fee_amount, raw_delta_fee)
    };
    let net_transfer_amount = transfer_amount
        .checked_sub(fee_amount)
        .ok_or(TokenProofGenerationError::FeeCalculation)?;

    // split and encrypt fee
    let (fee_amount_lo, fee_amount_hi) = try_split_u64(fee_amount, FEE_AMOUNT_LO_BITS)
        .ok_or(TokenProofGenerationError::IllegalAmountBitLength)?;
    let (fee_ciphertext_lo, fee_opening_lo) = FeeCiphertext::new(
        fee_amount_lo,
        destination_elgamal_pubkey,
        withdraw_withheld_authority_elgamal_pubkey,
    );
    let (fee_ciphertext_hi, fee_opening_hi) = FeeCiphertext::new(
        fee_amount_hi,
        destination_elgamal_pubkey,
        withdraw_withheld_authority_elgamal_pubkey,
    );

    // create combined commitments and openings to be used to generate proofs
    let combined_transfer_amount_commitment = try_combine_lo_hi_commitments(
        transfer_amount_grouped_ciphertext_lo.get_commitment(),
        transfer_amount_grouped_ciphertext_hi.get_commitment(),
        TRANSFER_AMOUNT_LO_BITS,
    )
    .ok_or(TokenProofGenerationError::IllegalAmountBitLength)?;
    let combined_transfer_amount_opening = try_combine_lo_hi_openings(
        &transfer_amount_opening_lo,
        &transfer_amount_opening_hi,
        TRANSFER_AMOUNT_LO_BITS,
    )
    .ok_or(TokenProofGenerationError::IllegalAmountBitLength)?;

    let combined_fee_commitment = try_combine_lo_hi_commitments(
        fee_ciphertext_lo.get_commitment(),
        fee_ciphertext_hi.get_commitment(),
        FEE_AMOUNT_LO_BITS,
    )
    .ok_or(TokenProofGenerationError::IllegalAmountBitLength)?;
    let combined_fee_opening =
        try_combine_lo_hi_openings(&fee_opening_lo, &fee_opening_hi, FEE_AMOUNT_LO_BITS)
            .ok_or(TokenProofGenerationError::IllegalAmountBitLength)?;

    // compute net transfer amount = transfer_amount - fee
    #[allow(clippy::arithmetic_side_effects)]
    let net_transfer_amount_commitment =
        combined_transfer_amount_commitment - combined_fee_commitment;
    #[allow(clippy::arithmetic_side_effects)]
    let net_transfer_amount_opening = &combined_transfer_amount_opening - &combined_fee_opening;

    // compute claimed and real delta commitment
    let (claimed_commitment, claimed_opening) = Pedersen::new(claimed_delta_fee);
    let (delta_commitment, delta_opening) = compute_delta_commitment_and_opening(
        (
            &combined_transfer_amount_commitment,
            &combined_transfer_amount_opening,
        ),
        (&combined_fee_commitment, &combined_fee_opening),
        transfer_fee_basis_points,
    );

    // generate fee sigma proof
    let percentage_with_cap_proof_data = PercentageWithCapProofData::new(
        &combined_fee_commitment,
        &combined_fee_opening,
        fee_amount,
        &delta_commitment,
        &delta_opening,
        claimed_delta_fee,
        &claimed_commitment,
        &claimed_opening,
        transfer_fee_maximum_fee,
    )
    .map_err(TokenProofGenerationError::from)?;

    // encrypt the fee amount under the destination and withdraw withheld authority
    // ElGamal public key
    #[cfg(not(target_arch = "wasm32"))]
    let fee_destination_withdraw_withheld_authority_ciphertext_lo = GroupedElGamal::encrypt_with(
        [
            destination_elgamal_pubkey,
            withdraw_withheld_authority_elgamal_pubkey,
        ],
        fee_amount_lo,
        &fee_opening_lo,
    );
    #[cfg(target_arch = "wasm32")]
    let fee_destination_withdraw_withheld_authority_ciphertext_lo =
        GroupedElGamalCiphertext2Handles::encrypt_with_u64(
            destination_elgamal_pubkey,
            withdraw_withheld_authority_elgamal_pubkey,
            fee_amount_lo,
            &fee_opening_lo,
        );

    #[cfg(not(target_arch = "wasm32"))]
    let fee_destination_withdraw_withheld_authority_ciphertext_hi = GroupedElGamal::encrypt_with(
        [
            destination_elgamal_pubkey,
            withdraw_withheld_authority_elgamal_pubkey,
        ],
        fee_amount_hi,
        &fee_opening_hi,
    );
    #[cfg(target_arch = "wasm32")]
    let fee_destination_withdraw_withheld_authority_ciphertext_hi =
        GroupedElGamalCiphertext2Handles::encrypt_with_u64(
            destination_elgamal_pubkey,
            withdraw_withheld_authority_elgamal_pubkey,
            fee_amount_hi,
            &fee_opening_hi,
        );

    // generate fee ciphertext validity data
    let fee_ciphertext_validity_proof_data =
        BatchedGroupedCiphertext2HandlesValidityProofData::new(
            destination_elgamal_pubkey,
            withdraw_withheld_authority_elgamal_pubkey,
            &fee_destination_withdraw_withheld_authority_ciphertext_lo,
            &fee_destination_withdraw_withheld_authority_ciphertext_hi,
            fee_amount_lo,
            fee_amount_hi,
            &fee_opening_lo,
            &fee_opening_hi,
        )
        .map_err(TokenProofGenerationError::from)?;

    // generate range proof data
    let delta_fee_complement = MAX_FEE_BASIS_POINTS_SUB_ONE
        .checked_sub(claimed_delta_fee)
        .ok_or(TokenProofGenerationError::FeeCalculation)?;

    let max_fee_basis_points_sub_one_commitment =
        Pedersen::with(MAX_FEE_BASIS_POINTS_SUB_ONE, &PedersenOpening::default());
    #[allow(clippy::arithmetic_side_effects)]
    let claimed_complement_commitment =
        max_fee_basis_points_sub_one_commitment - claimed_commitment;
    #[allow(clippy::arithmetic_side_effects)]
    let claimed_complement_opening = PedersenOpening::default() - &claimed_opening;

    let range_proof_data = BatchedRangeProofU256Data::new(
        vec![
            &new_available_balance_commitment,
            transfer_amount_grouped_ciphertext_lo.get_commitment(),
            transfer_amount_grouped_ciphertext_hi.get_commitment(),
            &claimed_commitment,
            &claimed_complement_commitment,
            fee_ciphertext_lo.get_commitment(),
            fee_ciphertext_hi.get_commitment(),
            &net_transfer_amount_commitment,
        ],
        vec![
            new_decrypted_available_balance,
            transfer_amount_lo,
            transfer_amount_hi,
            claimed_delta_fee,
            delta_fee_complement,
            fee_amount_lo,
            fee_amount_hi,
            net_transfer_amount,
        ],
        vec![
            REMAINING_BALANCE_BIT_LENGTH,
            TRANSFER_AMOUNT_LO_BITS,
            TRANSFER_AMOUNT_HI_BITS,
            DELTA_BIT_LENGTH,
            DELTA_BIT_LENGTH,
            FEE_AMOUNT_LO_BITS,
            FEE_AMOUNT_HI_BITS,
            NET_TRANSFER_AMOUNT_BIT_LENGTH,
        ],
        vec![
            &new_source_opening,
            &transfer_amount_opening_lo,
            &transfer_amount_opening_hi,
            &claimed_opening,
            &claimed_complement_opening,
            &fee_opening_lo,
            &fee_opening_hi,
            &net_transfer_amount_opening,
        ],
    )
    .map_err(TokenProofGenerationError::from)?;

    Ok(TransferWithFeeProofData {
        equality_proof_data,
        transfer_amount_ciphertext_validity_proof_data_with_ciphertext,
        percentage_with_cap_proof_data,
        fee_ciphertext_validity_proof_data,
        range_proof_data,
    })
}

fn calculate_fee(transfer_amount: u64, fee_rate_basis_points: u16) -> Option<(u64, u64)> {
    let numerator = (transfer_amount as u128).checked_mul(fee_rate_basis_points as u128)?;

    // Warning: Division may involve CPU opcodes that have variable execution times.
    // This non-constant-time execution of the fee calculation can theoretically
    // reveal information about the transfer amount. For transfers that involve
    // extremely sensitive data, additional care should be put into how the fees
    // are calculated.
    let fee = numerator
        .checked_add(ONE_IN_BASIS_POINTS)?
        .checked_sub(1)?
        .checked_div(ONE_IN_BASIS_POINTS)?;

    let delta_fee = fee
        .checked_mul(ONE_IN_BASIS_POINTS)?
        .checked_sub(numerator)?;

    Some((fee as u64, delta_fee as u64))
}

#[allow(clippy::arithmetic_side_effects)]
fn compute_delta_commitment_and_opening(
    (combined_commitment, combined_opening): (&PedersenCommitment, &PedersenOpening),
    (combined_fee_commitment, combined_fee_opening): (&PedersenCommitment, &PedersenOpening),
    fee_rate_basis_points: u16,
) -> (PedersenCommitment, PedersenOpening) {
    let fee_rate_scalar = Scalar::from(fee_rate_basis_points);
    let delta_commitment = combined_fee_commitment * Scalar::from(MAX_FEE_BASIS_POINTS)
        - combined_commitment * fee_rate_scalar;
    let delta_opening = combined_fee_opening * Scalar::from(MAX_FEE_BASIS_POINTS)
        - combined_opening * fee_rate_scalar;

    (delta_commitment, delta_opening)
}
