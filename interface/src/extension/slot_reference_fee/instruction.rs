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
    solana_zero_copy::unaligned::{U16, U64},
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
    ///   1. `[]` The fee destination: an account owned by the stake program.
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
    ///   1. `[]` The new fee destination: an account owned by the stake program.
    ///   2. `[signer]` The mint's slot reference fee authority.
    ///
    ///   * Multisignature authority
    ///   0. `[writable]` The mint.
    ///   1. `[]` The new fee destination: an account owned by the stake program.
    ///   2. `[]` The mint's multisignature authority.
    ///   3. `..3+M` `[signer]` M signer accounts.
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
    /// Permissionless instruction to move the fees harvested to the mint to the
    /// settler's token account. The settler (a program of the issuer's choosing,
    /// fixed at initialization) sells them for SOL, burns half of it and puts the
    /// other half into the mint's `fee_destination`, a stake account. The token
    /// program never pays anything to a wallet.
    ///
    /// Accounts expected by this instruction:
    ///
    ///   0. `[writable]` The mint.
    ///   1. `[writable]` A token account of this mint owned by the configured
    ///      `settler`.
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
    /// Stake account that the staked half of every settlement goes into
    pub fee_destination: Address,
    /// Fast ratchet: fee for the n-th reference in a slot is `floor * n * n` basis points
    pub floor_basis_points: U16,
    /// Fast ratchet cap in basis points
    pub cap_basis_points: U16,
    /// Fast ratchet: references per slot with no fee
    pub free_references: U16,
    /// Slow ratchet: fee for an account's m-th reference in a window is `slow_floor * m * m`
    pub slow_floor_basis_points: U16,
    /// Slow ratchet cap in basis points
    pub slow_cap_basis_points: U16,
    /// Slow ratchet: references per window per account with no fee
    pub slow_free_references: U16,
    /// Slow ratchet window, in slots
    pub slow_window_slots: U64,
    /// Authority of the token account that withdrawals of withheld fees go to
    pub settler: Address,
    /// Withdraw authority the fee destination must carry
    pub stake_withdrawer: Address,
    /// Earliest lockup epoch the fee destination may carry
    pub stake_lockup_epoch: U64,
    /// Transfers below this many tokens do not count on the fast ratchet
    pub min_reference_amount: U64,
}

/// Data expected by `SlotReferenceFeeInstruction::Set`
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub struct SetInstructionData {
    /// New fee destination, a stake account
    pub fee_destination: Address,
    /// New fast floor, in basis points
    pub floor_basis_points: U16,
    /// New fast cap, in basis points
    pub cap_basis_points: U16,
    /// New number of free references per slot
    pub free_references: U16,
    /// New slow floor, in basis points
    pub slow_floor_basis_points: U16,
    /// New slow cap, in basis points
    pub slow_cap_basis_points: U16,
    /// New number of free references per window per account
    pub slow_free_references: U16,
    /// New slow window, in slots
    pub slow_window_slots: U64,
}

/// Create an `Initialize` instruction
#[allow(clippy::too_many_arguments)]
pub fn initialize(
    token_program_id: &Address,
    mint: &Address,
    authority: Option<&Address>,
    fee_destination: &Address,
    settler: &Address,
    floor_basis_points: u16,
    cap_basis_points: u16,
    free_references: u16,
    slow_floor_basis_points: u16,
    slow_cap_basis_points: u16,
    slow_free_references: u16,
    slow_window_slots: u64,
    stake_withdrawer: &Address,
    stake_lockup_epoch: u64,
    min_reference_amount: u64,
) -> Result<Instruction, ProgramError> {
    check_program_account(token_program_id)?;
    let accounts = vec![
        AccountMeta::new(*mint, false),
        AccountMeta::new_readonly(*fee_destination, false),
    ];
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
            slow_floor_basis_points: slow_floor_basis_points.into(),
            slow_cap_basis_points: slow_cap_basis_points.into(),
            slow_free_references: slow_free_references.into(),
            slow_window_slots: slow_window_slots.into(),
            settler: *settler,
            stake_withdrawer: *stake_withdrawer,
            stake_lockup_epoch: stake_lockup_epoch.into(),
            min_reference_amount: min_reference_amount.into(),
        },
    ))
}

/// Create a `Set` instruction
#[allow(clippy::too_many_arguments)]
pub fn set(
    token_program_id: &Address,
    mint: &Address,
    authority: &Address,
    signers: &[&Address],
    fee_destination: &Address,
    floor_basis_points: u16,
    cap_basis_points: u16,
    free_references: u16,
    slow_floor_basis_points: u16,
    slow_cap_basis_points: u16,
    slow_free_references: u16,
    slow_window_slots: u64,
) -> Result<Instruction, ProgramError> {
    check_program_account(token_program_id)?;
    let mut accounts = vec![
        AccountMeta::new(*mint, false),
        AccountMeta::new_readonly(*fee_destination, false),
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
            slow_floor_basis_points: slow_floor_basis_points.into(),
            slow_cap_basis_points: slow_cap_basis_points.into(),
            slow_free_references: slow_free_references.into(),
            slow_window_slots: slow_window_slots.into(),
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
    settler_token_account: &Address,
) -> Result<Instruction, ProgramError> {
    check_program_account(token_program_id)?;
    let accounts = vec![
        AccountMeta::new(*mint, false),
        AccountMeta::new(*settler_token_account, false),
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
