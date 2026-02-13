#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};
#[cfg(not(target_os = "solana"))]
use {
    crate::extension::{
        confidential_mint_burn::instruction::BurnInstructionData as ConfidentialBurnInstructionData,
        confidential_transfer::DecryptableBalance,
    },
    solana_zk_sdk::encryption::pod::elgamal::PodElGamalCiphertext,
    solana_zk_sdk::zk_elgamal_proof_program::{
        instruction::ProofInstruction,
        proof_data::{
            BatchedGroupedCiphertext3HandlesValidityProofData, BatchedRangeProofU128Data,
            CiphertextCommitmentEqualityProofData,
        },
    },
    spl_token_confidential_transfer_proof_extraction::instruction::{
        process_proof_location, ProofLocation,
    },
};
use {
    crate::{
        check_program_account,
        instruction::{encode_instruction, TokenInstruction},
    },
    bytemuck::{Pod, Zeroable},
    num_enum::{IntoPrimitive, TryFromPrimitive},
    solana_instruction::{AccountMeta, Instruction},
    solana_program_error::ProgramError,
    solana_pubkey::Pubkey,
    spl_pod::primitives::PodU64,
};

/// Permissioned Burn extension instructions
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Debug, PartialEq, IntoPrimitive, TryFromPrimitive)]
#[repr(u8)]
pub enum PermissionedBurnInstruction {
    /// Require permissioned burn for the given mint account
    ///
    /// Accounts expected by this instruction:
    ///
    ///   0. `[writable]`  The mint account to initialize.
    ///
    /// Data expected by this instruction:
    ///   `crate::extension::permissioned_burn::instruction::InitializeInstructionData`
    Initialize,
    /// Burn tokens when the mint has the permissioned burn extension enabled.
    ///
    /// Accounts expected by this instruction:
    ///
    ///   * Single authority
    ///   0. `[writable]` The source account to burn from.
    ///   1. `[writable]` The token mint.
    ///   2. `[signer]` The permissioned burn authority configured on the mint,
    ///      if any.
    ///   3. `[signer]` The source account's owner/delegate.
    ///
    ///   * Multisignature authority
    ///   0. `[writable]` The source account to burn from.
    ///   1. `[writable]` The token mint.
    ///   2. `[signer]` The permissioned burn authority configured on the mint,
    ///      if any.
    ///   3. `[]` The source account's multisignature owner/delegate.
    ///   4. `..4+M` `[signer]` M signer accounts for the multisig.
    ///
    /// Data expected by this instruction:
    ///   `crate::extension::permissioned_burn::instruction::BurnInstructionData`
    Burn,
    /// Burn tokens with expected decimals when the mint has the permissioned
    /// burn extension enabled.
    ///
    /// Accounts expected by this instruction match `Burn`.
    ///
    /// Data expected by this instruction:
    ///   `crate::extension::permissioned_burn::instruction::BurnCheckedInstructionData`
    BurnChecked,
    /// Burn tokens from confidential balance
    ///
    /// Fails if the destination account is frozen.
    ///
    /// Accounts expected by this instruction:
    ///
    ///   * Single authority
    ///   0. `[writable]` The SPL Token account.
    ///   1. `[writable]` The SPL Token mint.
    ///   2. `[]` (Optional) Instructions sysvar if at least one of the
    ///      `zk_elgamal_proof` instructions are included in the same
    ///      transaction.
    ///   3. `[]` (Optional) The context state account containing the
    ///      pre-verified `VerifyCiphertextCommitmentEquality` proof
    ///   4. `[]` (Optional) The context state account containing the
    ///      pre-verified `VerifyBatchedGroupedCiphertext3HandlesValidity` proof
    ///   5. `[]` (Optional) The context state account containing the
    ///      pre-verified `VerifyBatchedRangeProofU128`
    ///   6. `[signer]` The single account owner.
    ///
    ///   * Multisignature authority
    ///   0. `[writable]` The SPL Token mint.
    ///   1. `[]` The SPL Token mint. `[writable]` if the mint has a non-zero
    ///      supply elgamal-pubkey
    ///   2. `[]` (Optional) Instructions sysvar if at least one of the
    ///      `zk_elgamal_proof` instructions are included in the same
    ///      transaction.
    ///   3. `[]` (Optional) The context state account containing the
    ///      pre-verified `VerifyCiphertextCommitmentEquality` proof
    ///   4. `[]` (Optional) The context state account containing the
    ///      pre-verified `VerifyBatchedGroupedCiphertext3HandlesValidity` proof
    ///   5. `[]` (Optional) The context state account containing the
    ///      pre-verified `VerifyBatchedRangeProofU128`
    ///   6. `[]` The multisig account owner.
    ///   7. ..`[signer]` Required M signer accounts for the SPL Token Multisig
    ///
    /// Data expected by this instruction:
    ///   `crate::extension::confidential_mint_burn::instruction::BurnInstructionData`
    ConfidentialBurn,
}

/// Data expected by `PermissionedBurnInstruction::Initialize`
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Pod, Zeroable)]
#[repr(C)]
pub struct InitializeInstructionData {
    /// The public key for the account that is required for token burning.
    pub authority: Pubkey,
}

/// Data expected by `PermissionedBurnInstruction::Burn`
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Pod, Zeroable)]
#[repr(C)]
pub struct BurnInstructionData {
    /// The amount of tokens to burn.
    pub amount: PodU64,
}

/// Data expected by `PermissionedBurnInstruction::BurnChecked`
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Pod, Zeroable)]
#[repr(C)]
pub struct BurnCheckedInstructionData {
    /// The amount of tokens to burn.
    pub amount: PodU64,
    /// Expected number of base 10 digits to the right of the decimal place.
    pub decimals: u8,
}

/// Create an `Initialize` instruction
pub fn initialize(
    token_program_id: &Pubkey,
    mint: &Pubkey,
    authority: &Pubkey,
) -> Result<Instruction, ProgramError> {
    check_program_account(token_program_id)?;
    let accounts = vec![AccountMeta::new(*mint, false)];
    Ok(encode_instruction(
        token_program_id,
        accounts,
        TokenInstruction::PermissionedBurnExtension,
        PermissionedBurnInstruction::Initialize,
        &InitializeInstructionData {
            authority: *authority,
        },
    ))
}

/// Create a `Burn` instruction using the permissioned burn extension.
pub fn burn(
    token_program_id: &Pubkey,
    account: &Pubkey,
    mint: &Pubkey,
    permissioned_burn_authority: &Pubkey,
    authority: &Pubkey,
    signer_pubkeys: &[&Pubkey],
    amount: u64,
) -> Result<Instruction, ProgramError> {
    check_program_account(token_program_id)?;
    let data = BurnInstructionData {
        amount: amount.into(),
    };

    let mut accounts = Vec::with_capacity(4 + signer_pubkeys.len());
    accounts.push(AccountMeta::new(*account, false));
    accounts.push(AccountMeta::new(*mint, false));
    accounts.push(AccountMeta::new_readonly(
        *permissioned_burn_authority,
        true,
    ));
    accounts.push(AccountMeta::new_readonly(
        *authority,
        signer_pubkeys.is_empty(),
    ));
    for signer_pubkey in signer_pubkeys.iter() {
        accounts.push(AccountMeta::new_readonly(**signer_pubkey, true));
    }

    Ok(encode_instruction(
        token_program_id,
        accounts,
        TokenInstruction::PermissionedBurnExtension,
        PermissionedBurnInstruction::Burn,
        &data,
    ))
}

/// Create a `BurnChecked` instruction using the permissioned burn extension.
#[allow(clippy::too_many_arguments)]
pub fn burn_checked(
    token_program_id: &Pubkey,
    account: &Pubkey,
    mint: &Pubkey,
    permissioned_burn_authority: &Pubkey,
    authority: &Pubkey,
    signer_pubkeys: &[&Pubkey],
    amount: u64,
    decimals: u8,
) -> Result<Instruction, ProgramError> {
    check_program_account(token_program_id)?;
    let data = BurnCheckedInstructionData {
        amount: amount.into(),
        decimals,
    };

    let mut accounts = Vec::with_capacity(4 + signer_pubkeys.len());
    accounts.push(AccountMeta::new(*account, false));
    accounts.push(AccountMeta::new(*mint, false));
    accounts.push(AccountMeta::new_readonly(
        *permissioned_burn_authority,
        true,
    ));
    accounts.push(AccountMeta::new_readonly(
        *authority,
        signer_pubkeys.is_empty(),
    ));
    for signer_pubkey in signer_pubkeys.iter() {
        accounts.push(AccountMeta::new_readonly(**signer_pubkey, true));
    }

    Ok(encode_instruction(
        token_program_id,
        accounts,
        TokenInstruction::PermissionedBurnExtension,
        PermissionedBurnInstruction::BurnChecked,
        &data,
    ))
}

/// Create a `ConfidentialBurn` instruction
#[allow(clippy::too_many_arguments)]
#[cfg(not(target_os = "solana"))]
pub fn confidential_burn_with_split_proofs(
    token_program_id: &Pubkey,
    token_account: &Pubkey,
    mint: &Pubkey,
    permissioned_burn_authority: &Pubkey,
    new_decryptable_available_balance: &DecryptableBalance,
    burn_amount_auditor_ciphertext_lo: &PodElGamalCiphertext,
    burn_amount_auditor_ciphertext_hi: &PodElGamalCiphertext,
    authority: &Pubkey,
    multisig_signers: &[&Pubkey],
    equality_proof_location: ProofLocation<CiphertextCommitmentEqualityProofData>,
    ciphertext_validity_proof_location: ProofLocation<
        BatchedGroupedCiphertext3HandlesValidityProofData,
    >,
    range_proof_location: ProofLocation<BatchedRangeProofU128Data>,
) -> Result<Vec<Instruction>, ProgramError> {
    check_program_account(token_program_id)?;
    let mut accounts = vec![
        AccountMeta::new(*token_account, false),
        AccountMeta::new(*mint, false),
    ];

    let mut expected_instruction_offset = 1;
    let mut proof_instructions = vec![];

    let equality_proof_instruction_offset = process_proof_location(
        &mut accounts,
        &mut expected_instruction_offset,
        &mut proof_instructions,
        equality_proof_location,
        true,
        ProofInstruction::VerifyCiphertextCommitmentEquality,
    )?;

    let ciphertext_validity_proof_instruction_offset = process_proof_location(
        &mut accounts,
        &mut expected_instruction_offset,
        &mut proof_instructions,
        ciphertext_validity_proof_location,
        false,
        ProofInstruction::VerifyBatchedGroupedCiphertext3HandlesValidity,
    )?;

    let range_proof_instruction_offset = process_proof_location(
        &mut accounts,
        &mut expected_instruction_offset,
        &mut proof_instructions,
        range_proof_location,
        false,
        ProofInstruction::VerifyBatchedRangeProofU128,
    )?;

    accounts.push(AccountMeta::new_readonly(
        *permissioned_burn_authority,
        true,
    ));
    accounts.push(AccountMeta::new_readonly(
        *authority,
        multisig_signers.is_empty(),
    ));

    for multisig_signer in multisig_signers.iter() {
        accounts.push(AccountMeta::new_readonly(**multisig_signer, true));
    }

    let mut instructions = vec![encode_instruction(
        token_program_id,
        accounts,
        TokenInstruction::PermissionedBurnExtension,
        PermissionedBurnInstruction::ConfidentialBurn,
        &ConfidentialBurnInstructionData {
            new_decryptable_available_balance: *new_decryptable_available_balance,
            burn_amount_auditor_ciphertext_lo: *burn_amount_auditor_ciphertext_lo,
            burn_amount_auditor_ciphertext_hi: *burn_amount_auditor_ciphertext_hi,
            equality_proof_instruction_offset,
            ciphertext_validity_proof_instruction_offset,
            range_proof_instruction_offset,
        },
    )];

    instructions.extend(proof_instructions);

    Ok(instructions)
}
