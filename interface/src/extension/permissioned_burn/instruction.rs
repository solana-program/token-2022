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
    ///   0. `[writable]`  The mint account for which to enable.
    ///
    /// Data expected by this instruction:
    ///   `crate::extension::permissioned_burn::instruction::EnableInstructionData`
    Enable,
    /// Stop requiring burn to be signed by an additional authority.
    ///
    /// Accounts expected by this instruction:
    ///
    ///   0. `[writable]`  The mint account for which to enable.
    Disable,
}

/// Data expected by `PermissionedBurnInstruction::Enable`
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Pod, Zeroable)]
#[repr(C)]
pub struct EnableInstructionData {
    /// The public key for the account that is required for token burning.
    pub authority: Pubkey,
}

/// Create an `Enable` instruction
pub fn enable(
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
        PermissionedBurnInstruction::Enable,
        &EnableInstructionData {
            authority: *authority,
        },
    ))
}

/// Create a `Disable` instruction
pub fn disable(
    token_program_id: &Pubkey,
    mint: &Pubkey,
    authority: &Pubkey,
    signers: &[&Pubkey],
) -> Result<Instruction, ProgramError> {
    check_program_account(token_program_id)?;
    let mut accounts = vec![
        AccountMeta::new(*mint, false),
        AccountMeta::new_readonly(*authority, signers.is_empty()),
    ];
    for signer_pubkey in signers.iter() {
        accounts.push(AccountMeta::new_readonly(**signer_pubkey, true));
    }
    Ok(encode_instruction(
        token_program_id,
        accounts,
        TokenInstruction::PermissionedBurnExtension,
        PermissionedBurnInstruction::Disable,
        &(),
    ))
}
