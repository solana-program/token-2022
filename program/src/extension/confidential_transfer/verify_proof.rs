#[cfg(feature = "zk-ops")]
use {crate::next_account_view, pinocchio::AccountView, std::slice::IterMut};
use {
    solana_program_error::ProgramError,
    spl_token_2022_interface::{
        error::TokenError,
        extension::{confidential_transfer::instruction::*, transfer_fee::TransferFee},
    },
    spl_token_confidential_transfer_proof_extraction::{
        instruction::verify_and_extract_context, transfer::TransferProofContext,
        transfer_with_fee::TransferWithFeeProofContext, withdraw::WithdrawProofContext,
    },
};

/// Verify zero-knowledge proofs needed for a `Withdraw` instruction and return
/// the corresponding proof context.
#[cfg(feature = "zk-ops")]
pub fn verify_withdraw_proof(
    account_info_iter: &mut IterMut<AccountView>,
    equality_proof_instruction_offset: i64,
    range_proof_instruction_offset: i64,
) -> Result<WithdrawProofContext, ProgramError> {
    let sysvar_account_info =
        if equality_proof_instruction_offset != 0 || range_proof_instruction_offset != 0 {
            Some(next_account_view(account_info_iter)?)
        } else {
            None
        };

    let equality_proof_context = verify_and_extract_context::<
        CiphertextCommitmentEqualityProofData,
        CiphertextCommitmentEqualityProofContext,
    >(
        account_info_iter,
        equality_proof_instruction_offset,
        sysvar_account_info.as_deref(),
    )?;

    let range_proof_context =
        verify_and_extract_context::<BatchedRangeProofU64Data, BatchedRangeProofContext>(
            account_info_iter,
            range_proof_instruction_offset,
            sysvar_account_info.as_deref(),
        )?;

    // The `WithdrawProofContext` constructor verifies the consistency of the
    // individual proof context and generates a `WithdrawProofContext` struct
    // that is used to process the rest of the token-2022 logic.
    let withdraw_proof_context =
        WithdrawProofContext::verify_and_extract(&equality_proof_context, &range_proof_context)
            .map_err(|e| -> TokenError { e.into() })?;

    Ok(withdraw_proof_context)
}

/// Verify zero-knowledge proof needed for a `Transfer` instruction without fee
/// and return the corresponding proof context.
#[cfg(feature = "zk-ops")]
pub fn verify_transfer_proof(
    account_info_iter: &mut IterMut<AccountView>,
    equality_proof_instruction_offset: i64,
    ciphertext_validity_proof_instruction_offset: i64,
    range_proof_instruction_offset: i64,
) -> Result<TransferProofContext, ProgramError> {
    let sysvar_account_info = if equality_proof_instruction_offset != 0
        || ciphertext_validity_proof_instruction_offset != 0
        || range_proof_instruction_offset != 0
    {
        Some(next_account_view(account_info_iter)?)
    } else {
        None
    };

    let equality_proof_context = verify_and_extract_context::<
        CiphertextCommitmentEqualityProofData,
        CiphertextCommitmentEqualityProofContext,
    >(
        account_info_iter,
        equality_proof_instruction_offset,
        sysvar_account_info.as_deref(),
    )?;

    let ciphertext_validity_proof_context = verify_and_extract_context::<
        BatchedGroupedCiphertext3HandlesValidityProofData,
        BatchedGroupedCiphertext3HandlesValidityProofContext,
    >(
        account_info_iter,
        ciphertext_validity_proof_instruction_offset,
        sysvar_account_info.as_deref(),
    )?;

    let range_proof_context =
        verify_and_extract_context::<BatchedRangeProofU128Data, BatchedRangeProofContext>(
            account_info_iter,
            range_proof_instruction_offset,
            sysvar_account_info.as_deref(),
        )?;

    // The `TransferProofContext` constructor verifies the consistency of the
    // individual proof context and generates a `TransferWithFeeProofInfo` struct
    // that is used to process the rest of the token-2022 logic.
    let transfer_proof_context = TransferProofContext::verify_and_extract(
        &equality_proof_context,
        &ciphertext_validity_proof_context,
        &range_proof_context,
    )
    .map_err(|e| -> TokenError { e.into() })?;

    Ok(transfer_proof_context)
}

/// Verify zero-knowledge proof needed for a `Transfer` instruction with fee and
/// return the corresponding proof context.
#[cfg(feature = "zk-ops")]
#[allow(clippy::too_many_arguments)]
pub fn verify_transfer_with_fee_proof(
    account_info_iter: &mut IterMut<AccountView>,
    equality_proof_instruction_offset: i64,
    transfer_amount_ciphertext_validity_proof_instruction_offset: i64,
    fee_sigma_proof_instruction_offset: i64,
    fee_ciphertext_validity_proof_instruction_offset: i64,
    range_proof_instruction_offset: i64,
    fee_parameters: &TransferFee,
) -> Result<TransferWithFeeProofContext, ProgramError> {
    let sysvar_account_info = if equality_proof_instruction_offset != 0
        || transfer_amount_ciphertext_validity_proof_instruction_offset != 0
        || fee_sigma_proof_instruction_offset != 0
        || fee_ciphertext_validity_proof_instruction_offset != 0
        || range_proof_instruction_offset != 0
    {
        Some(next_account_view(account_info_iter)?)
    } else {
        None
    };

    let equality_proof_context = verify_and_extract_context::<
        CiphertextCommitmentEqualityProofData,
        CiphertextCommitmentEqualityProofContext,
    >(
        account_info_iter,
        equality_proof_instruction_offset,
        sysvar_account_info.as_deref(),
    )?;

    let transfer_amount_ciphertext_validity_proof_context = verify_and_extract_context::<
        BatchedGroupedCiphertext3HandlesValidityProofData,
        BatchedGroupedCiphertext3HandlesValidityProofContext,
    >(
        account_info_iter,
        transfer_amount_ciphertext_validity_proof_instruction_offset,
        sysvar_account_info.as_deref(),
    )?;

    let fee_sigma_proof_context =
        verify_and_extract_context::<PercentageWithCapProofData, PercentageWithCapProofContext>(
            account_info_iter,
            fee_sigma_proof_instruction_offset,
            sysvar_account_info.as_deref(),
        )?;

    let fee_ciphertext_validity_proof_context = verify_and_extract_context::<
        BatchedGroupedCiphertext2HandlesValidityProofData,
        BatchedGroupedCiphertext2HandlesValidityProofContext,
    >(
        account_info_iter,
        fee_ciphertext_validity_proof_instruction_offset,
        sysvar_account_info.as_deref(),
    )?;

    let range_proof_context =
        verify_and_extract_context::<BatchedRangeProofU256Data, BatchedRangeProofContext>(
            account_info_iter,
            range_proof_instruction_offset,
            sysvar_account_info.as_deref(),
        )?;

    // The `TransferWithFeeProofContext` constructor verifies the consistency of
    // the individual proof context and generates a
    // `TransferWithFeeProofInfo` struct that is used to process the rest of
    // the token-2022 logic. The consistency check includes verifying
    // whether the fee-related zkps were generated with respect to the correct fee
    // parameter that is stored in the mint extension.
    let transfer_with_fee_proof_context = TransferWithFeeProofContext::verify_and_extract(
        &equality_proof_context,
        &transfer_amount_ciphertext_validity_proof_context,
        &fee_sigma_proof_context,
        &fee_ciphertext_validity_proof_context,
        &range_proof_context,
        fee_parameters.transfer_fee_basis_points.into(),
        fee_parameters.maximum_fee.into(),
    )
    .map_err(|e| -> TokenError { e.into() })?;

    Ok(transfer_with_fee_proof_context)
}
