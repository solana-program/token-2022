#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};
use {
    crate::{
        check_program_account,
        instruction::{encode_instruction, transfer_checked, TokenInstruction},
    },
    alloc::vec,
    bytemuck::{Pod, Zeroable},
    num_enum::{IntoPrimitive, TryFromPrimitive},
    solana_address::Address,
    solana_instruction::{AccountMeta, Instruction},
    solana_nullable::MaybeNull,
    solana_program_error::ProgramError,
    solana_zero_copy::unaligned::U16,
};

/// Slot reference fee extension instructions
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Debug, PartialEq, IntoPrimitive, TryFromPrimitive)]
#[repr(u8)]
pub enum SlotReferenceFeeInstruction {
    /// Initialize the slot reference fee on a new mint.
    ///
    /// Fails if the mint has already been initialized, so must be called before
    /// `InitializeMint`.
    ///
    /// Accounts expected by this instruction:
    ///
    ///   0. `[writable]` The mint to initialize.
    ///
    /// Data expected by this instruction:
    ///   `crate::extension::slot_reference_fee::instruction::InitializeInstructionData`
    Initialize,
    /// Update the fee schedule and the fee destination. Only supported while the
    /// mint's slot reference fee authority is set. The sink share is immutable.
    ///
    /// Accounts expected by this instruction:
    ///
    ///   * Single authority
    ///   0. `[writable]` The mint.
    ///   1. `[signer]` The mint's slot reference fee authority.
    ///
    ///   * Multisignature authority
    ///   0. `[writable]` The mint.
    ///   1. `[]` The mint's multisignature authority.
    ///   2. `..2+M` `[signer]` M signer accounts.
    ///
    /// Data expected by this instruction:
    ///   `crate::extension::slot_reference_fee::instruction::SetInstructionData`
    Set,
    /// Permissionless instruction to move all withheld slot reference fees from
    /// token accounts to the mint. Succeeds for frozen accounts. Accounts
    /// without the `SlotReferenceFeeAmount` extension are skipped.
    ///
    /// Accounts expected by this instruction:
    ///
    ///   0. `[writable]` The mint.
    ///   1. `..1+N` `[writable]` The token accounts to harvest from.
    HarvestWithheldTokensToMint,
    /// Permissionless instruction to distribute the fees harvested to the mint:
    /// `sink_share_basis_points` of them to the sink token account, the rest to
    /// the mint's `fee_destination`.
    ///
    /// The sink token account must be a token account of this mint owned by the
    /// incinerator address (`slot_reference_fee::sink_owner()`), which nobody can
    /// sign for. The program never moves tokens out of it.
    ///
    /// Accounts expected by this instruction:
    ///
    ///   0. `[writable]` The mint.
    ///   1. `[writable]` The sink token account.
    ///   2. `[writable]` The fee destination token account, equal to the mint's
    ///      configured `fee_destination`.
    WithdrawWithheldTokensFromMint,
}

/// Data expected by `SlotReferenceFeeInstruction::Initialize`
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub struct InitializeInstructionData {
    /// Optional authority that may update the schedule and destination
    pub authority: MaybeNull<Address>,
    /// Token account of the mint that receives the non-sink share
    pub fee_destination: Address,
    /// Fee for the n-th reference in a slot is `floor * n * n` basis points
    pub floor_basis_points: U16,
    /// Hard cap in basis points
    pub cap_basis_points: U16,
    /// References per slot with no fee
    pub free_references: U16,
    /// Share of withdrawals that goes to the sink, in basis points
    pub sink_share_basis_points: U16,
}

/// Data expected by `SlotReferenceFeeInstruction::Set`
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub struct SetInstructionData {
    /// New fee destination
    pub fee_destination: Address,
    /// New floor, in basis points
    pub floor_basis_points: U16,
    /// New cap, in basis points
    pub cap_basis_points: U16,
    /// New number of free references per slot
    pub free_references: U16,
}

/// Create an `Initialize` instruction
#[allow(clippy::too_many_arguments)]
pub fn initialize(
    token_program_id: &Address,
    mint: &Address,
    authority: Option<&Address>,
    fee_destination: &Address,
    floor_basis_points: u16,
    cap_basis_points: u16,
    free_references: u16,
    sink_share_basis_points: u16,
) -> Result<Instruction, ProgramError> {
    check_program_account(token_program_id)?;
    let accounts = vec![AccountMeta::new(*mint, false)];
    Ok(encode_instruction(
        token_program_id,
        accounts,
        TokenInstruction::SlotReferenceFeeExtension,
        SlotReferenceFeeInstruction::Initialize,
        &InitializeInstructionData {
            authority: authority
                .copied()
                .try_into()
                .map_err(|_| ProgramError::InvalidArgument)?,
            fee_destination: *fee_destination,
            floor_basis_points: floor_basis_points.into(),
            cap_basis_points: cap_basis_points.into(),
            free_references: free_references.into(),
            sink_share_basis_points: sink_share_basis_points.into(),
        },
    ))
}

/// Create a `Set` instruction
pub fn set(
    token_program_id: &Address,
    mint: &Address,
    authority: &Address,
    signers: &[&Address],
    fee_destination: &Address,
    floor_basis_points: u16,
    cap_basis_points: u16,
    free_references: u16,
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
        TokenInstruction::SlotReferenceFeeExtension,
        SlotReferenceFeeInstruction::Set,
        &SetInstructionData {
            fee_destination: *fee_destination,
            floor_basis_points: floor_basis_points.into(),
            cap_basis_points: cap_basis_points.into(),
            free_references: free_references.into(),
        },
    ))
}

/// Create a `HarvestWithheldTokensToMint` instruction
pub fn harvest_withheld_tokens_to_mint(
    token_program_id: &Address,
    mint: &Address,
    sources: &[&Address],
) -> Result<Instruction, ProgramError> {
    check_program_account(token_program_id)?;
    let mut accounts = vec![AccountMeta::new(*mint, false)];
    for source in sources.iter() {
        accounts.push(AccountMeta::new(**source, false));
    }
    Ok(encode_instruction(
        token_program_id,
        accounts,
        TokenInstruction::SlotReferenceFeeExtension,
        SlotReferenceFeeInstruction::HarvestWithheldTokensToMint,
        &(),
    ))
}

/// Create a `WithdrawWithheldTokensFromMint` instruction
pub fn withdraw_withheld_tokens_from_mint(
    token_program_id: &Address,
    mint: &Address,
    sink: &Address,
    fee_destination: &Address,
) -> Result<Instruction, ProgramError> {
    check_program_account(token_program_id)?;
    let accounts = vec![
        AccountMeta::new(*mint, false),
        AccountMeta::new(*sink, false),
        AccountMeta::new(*fee_destination, false),
    ];
    Ok(encode_instruction(
        token_program_id,
        accounts,
        TokenInstruction::SlotReferenceFeeExtension,
        SlotReferenceFeeInstruction::WithdrawWithheldTokensFromMint,
        &(),
    ))
}

/// Create a `TransferChecked` instruction with the mint marked writable, which a
/// mint carrying this extension requires.
#[allow(clippy::too_many_arguments)]
pub fn transfer_checked_writable_mint(
    token_program_id: &Address,
    source: &Address,
    mint: &Address,
    destination: &Address,
    authority: &Address,
    signers: &[&Address],
    amount: u64,
    decimals: u8,
) -> Result<Instruction, ProgramError> {
    let mut instruction = transfer_checked(
        token_program_id,
        source,
        mint,
        destination,
        authority,
        signers,
        amount,
        decimals,
    )?;
    for meta in instruction.accounts.iter_mut() {
        if meta.pubkey == *mint {
            meta.is_writable = true;
        }
    }
    Ok(instruction)
}
