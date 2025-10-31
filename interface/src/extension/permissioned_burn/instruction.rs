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
