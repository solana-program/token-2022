use {
    crate::{
        check_program_account,
        instruction::{encode_instruction, TokenInstruction},
    },
    bytemuck::{Pod, Zeroable},
    num_enum::{IntoPrimitive, TryFromPrimitive},
    solana_address::Address,
    solana_instruction::{AccountMeta, Instruction},
    solana_nullable::MaybeNull,
    solana_program_error::ProgramError,
};
#[cfg(feature = "serde")]
use {
    serde::{Deserialize, Serialize},
    serde_with::{As, DisplayFromStr},
};

/// Transfer hook extension instructions
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Debug, PartialEq, IntoPrimitive, TryFromPrimitive)]
#[repr(u8)]
pub enum TransferHookInstruction {
    /// Initialize a new mint with a transfer hook program.
    ///
    /// Fails if the mint has already been initialized, so must be called before
    /// `InitializeMint`.
    ///
    /// The mint must have exactly enough space allocated for the base mint (82
    /// bytes), plus 83 bytes of padding, 1 byte reserved for the account type,
    /// then space required for this extension, plus any others.
    ///
    /// Accounts expected by this instruction:
    ///
    ///   0. `[writable]` The mint to initialize.
    ///
    /// Data expected by this instruction:
    ///   `crate::extension::transfer_hook::instruction::InitializeInstructionData`
    Initialize,
    /// Update the transfer hook program id. Only supported for mints that
    /// include the `TransferHook` extension.
    ///
    /// Accounts expected by this instruction:
    ///
    ///   * Single authority
    ///   0. `[writable]` The mint.
    ///   1. `[signer]` The transfer hook authority.
    ///
    ///   * Multisignature authority
    ///   0. `[writable]` The mint.
    ///   1. `[]` The mint's transfer hook authority.
    ///   2. `..2+M` `[signer]` M signer accounts.
    ///
    /// Data expected by this instruction:
    ///   `crate::extension::transfer_hook::UpdateInstructionData`
    Update,
}

/// Data expected by `Initialize`
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Pod, Zeroable)]
#[repr(C)]
pub struct InitializeInstructionData {
    /// The public key for the account that can update the program id
    #[cfg_attr(feature = "serde", serde(with = "As::<Option<DisplayFromStr>>"))]
    pub authority: MaybeNull<Address>,
    /// The program id that performs logic during transfers
    #[cfg_attr(feature = "serde", serde(with = "As::<Option<DisplayFromStr>>"))]
    pub program_id: MaybeNull<Address>,
}

/// Data expected by `Update`
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Pod, Zeroable)]
#[repr(C)]
pub struct UpdateInstructionData {
    /// The program id that performs logic during transfers
    #[cfg_attr(feature = "serde", serde(with = "As::<Option<DisplayFromStr>>"))]
    pub program_id: MaybeNull<Address>,
}

/// Create an `Initialize` instruction
pub fn initialize(
    token_program_id: &Address,
    mint: &Address,
    authority: Option<Address>,
    transfer_hook_program_id: Option<Address>,
) -> Result<Instruction, ProgramError> {
    check_program_account(token_program_id)?;
    let accounts = vec![AccountMeta::new(*mint, false)];
    Ok(encode_instruction(
        token_program_id,
        accounts,
        TokenInstruction::TransferHookExtension,
        TransferHookInstruction::Initialize,
        &InitializeInstructionData {
            authority: authority
                .try_into()
                .map_err(|_| ProgramError::InvalidArgument)?,
            program_id: transfer_hook_program_id
                .try_into()
                .map_err(|_| ProgramError::InvalidArgument)?,
        },
    ))
}

/// Create an `Update` instruction
pub fn update(
    token_program_id: &Address,
    mint: &Address,
    authority: &Address,
    signers: &[&Address],
    transfer_hook_program_id: Option<Address>,
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
        TokenInstruction::TransferHookExtension,
        TransferHookInstruction::Update,
        &UpdateInstructionData {
            program_id: transfer_hook_program_id
                .try_into()
                .map_err(|_| ProgramError::InvalidArgument)?,
        },
    ))
}
