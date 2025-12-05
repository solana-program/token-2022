#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};
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
    ///   2. `[signer]` The permissioned burn authority configured on the mint.
    ///   3. `[signer]` The source account's owner/delegate.
    ///
    ///   * Multisignature authority
    ///   0. `[writable]` The source account to burn from.
    ///   1. `[writable]` The token mint.
    ///   2. `[signer]` The permissioned burn authority configured on the mint.
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
