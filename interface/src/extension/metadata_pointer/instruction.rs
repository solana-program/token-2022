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

/// Metadata pointer extension instructions
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Debug, PartialEq, IntoPrimitive, TryFromPrimitive)]
#[repr(u8)]
pub enum MetadataPointerInstruction {
    /// Initialize a new mint with a metadata pointer
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
    ///   `crate::extension::metadata_pointer::instruction::InitializeInstructionData`
    Initialize,
    /// Update the metadata pointer address. Only supported for mints that
    /// include the `MetadataPointer` extension.
    ///
    /// Accounts expected by this instruction:
    ///
    ///   * Single authority
    ///   0. `[writable]` The mint.
    ///   1. `[signer]` The metadata pointer authority.
    ///
    ///   * Multisignature authority
    ///   0. `[writable]` The mint.
    ///   1. `[]` The mint's metadata pointer authority.
    ///   2. `..2+M` `[signer]` M signer accounts.
    ///
    /// Data expected by this instruction:
    ///   `crate::extension::metadata_pointer::instruction::UpdateInstructionData`
    Update,
}

/// Data expected by `Initialize`
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Pod, Zeroable)]
#[repr(C)]
pub struct InitializeInstructionData {
    /// The public key for the account that can update the metadata address
    #[cfg_attr(feature = "serde", serde(with = "As::<Option<DisplayFromStr>>"))]
    pub authority: MaybeNull<Address>,
    /// The account address that holds the metadata
    #[cfg_attr(feature = "serde", serde(with = "As::<Option<DisplayFromStr>>"))]
    pub metadata_address: MaybeNull<Address>,
}

/// Data expected by `Update`
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Pod, Zeroable)]
#[repr(C)]
pub struct UpdateInstructionData {
    /// The new account address that holds the metadata
    #[cfg_attr(feature = "serde", serde(with = "As::<Option<DisplayFromStr>>"))]
    pub metadata_address: MaybeNull<Address>,
}

/// Create an `Initialize` instruction
pub fn initialize(
    token_program_id: &Address,
    mint: &Address,
    authority: Option<Address>,
    metadata_address: Option<Address>,
) -> Result<Instruction, ProgramError> {
    check_program_account(token_program_id)?;
    let accounts = vec![AccountMeta::new(*mint, false)];
    Ok(encode_instruction(
        token_program_id,
        accounts,
        TokenInstruction::MetadataPointerExtension,
        MetadataPointerInstruction::Initialize,
        &InitializeInstructionData {
            authority: authority
                .try_into()
                .map_err(|_| ProgramError::InvalidArgument)?,
            metadata_address: metadata_address
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
    metadata_address: Option<Address>,
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
        TokenInstruction::MetadataPointerExtension,
        MetadataPointerInstruction::Update,
        &UpdateInstructionData {
            metadata_address: metadata_address
                .try_into()
                .map_err(|_| ProgramError::InvalidArgument)?,
        },
    ))
}
