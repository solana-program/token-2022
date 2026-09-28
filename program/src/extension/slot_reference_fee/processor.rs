use {
    crate::processor::Processor,
    solana_account_info::{next_account_info, AccountInfo},
    solana_address::Address,
    solana_clock::Clock,
    solana_msg::msg,
    solana_program_error::{ProgramError, ProgramResult},
    solana_sysvar::Sysvar,
    spl_token_2022_interface::{
        check_program_account,
        error::TokenError,
        extension::{
            slot_reference_fee::{
                instruction::{
                    InitializeInstructionData, SetInstructionData, SlotReferenceFeeInstruction,
                },
                sink_owner, SlotReferenceFeeAmount, SlotReferenceFeeConfig, MAX_FEE_BASIS_POINTS,
            },
            BaseStateWithExtensions, BaseStateWithExtensionsMut, PodStateWithExtensions,
            PodStateWithExtensionsMut,
        },
        instruction::{decode_instruction_data, decode_instruction_type},
        pod::{PodAccount, PodMint},
    },
};

fn check_schedule(floor: u16, cap: u16) -> ProgramResult {
    if cap > MAX_FEE_BASIS_POINTS || floor > cap {
        return Err(TokenError::SlotReferenceFeeExceedsMaximum.into());
    }
    Ok(())
}

fn process_initialize(accounts: &[AccountInfo], data: &InitializeInstructionData) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let mint_account_info = next_account_info(account_info_iter)?;
    check_program_account(mint_account_info.owner)?;

    check_schedule(
        u16::from(data.floor_basis_points),
        u16::from(data.cap_basis_points),
    )?;
    if u16::from(data.sink_share_basis_points) > MAX_FEE_BASIS_POINTS {
        return Err(TokenError::SlotReferenceFeeExceedsMaximum.into());
    }

    let mut mint_data = mint_account_info.data.borrow_mut();
    let mut mint = PodStateWithExtensionsMut::<PodMint>::unpack_uninitialized(&mut mint_data)?;
    let extension = mint.init_extension::<SlotReferenceFeeConfig>(true)?;
    extension.authority = data.authority;
    extension.fee_destination = data.fee_destination;
    extension.floor_basis_points = data.floor_basis_points;
    extension.cap_basis_points = data.cap_basis_points;
    extension.free_references = data.free_references;
    extension.sink_share_basis_points = data.sink_share_basis_points;
    extension.slot = 0u64.into();
    extension.count = 0u64.into();
    extension.withheld_amount = 0u64.into();
    Ok(())
}

fn process_set(
    program_id: &Address,
    accounts: &[AccountInfo],
    data: &SetInstructionData,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let mint_account_info = next_account_info(account_info_iter)?;
    let authority_info = next_account_info(account_info_iter)?;
    let authority_info_data_len = authority_info.data_len();
    check_program_account(mint_account_info.owner)?;

    check_schedule(
        u16::from(data.floor_basis_points),
        u16::from(data.cap_basis_points),
    )?;

    let mut mint_data = mint_account_info.data.borrow_mut();
    let mut mint = PodStateWithExtensionsMut::<PodMint>::unpack(&mut mint_data)?;
    let extension = mint.get_extension_mut::<SlotReferenceFeeConfig>()?;
    let maybe_authority: Option<Address> = extension.authority.into();
    let authority = maybe_authority.ok_or(TokenError::NoAuthorityExists)?;
    Processor::validate_owner(
        program_id,
        &authority,
        authority_info,
        authority_info_data_len,
        account_info_iter.as_slice(),
    )?;

    extension.fee_destination = data.fee_destination;
    extension.floor_basis_points = data.floor_basis_points;
    extension.cap_basis_points = data.cap_basis_points;
    extension.free_references = data.free_references;
    Ok(())
}

fn harvest_from_account<'b>(
    mint_key: &'b Address,
    token_account_info: &'b AccountInfo<'_>,
) -> Result<u64, TokenError> {
    let mut token_account_data = token_account_info.data.borrow_mut();
    let mut token_account =
        PodStateWithExtensionsMut::<PodAccount>::unpack(&mut token_account_data)
            .map_err(|_| TokenError::InvalidState)?;
    if token_account.base.mint != *mint_key {
        return Err(TokenError::MintMismatch);
    }
    check_program_account(token_account_info.owner).map_err(|_| TokenError::InvalidState)?;
    let extension = token_account
        .get_extension_mut::<SlotReferenceFeeAmount>()
        .map_err(|_| TokenError::InvalidState)?;
    let withheld = u64::from(extension.withheld_amount);
    extension.withheld_amount = 0.into();
    Ok(withheld)
}

fn process_harvest_withheld_tokens_to_mint(accounts: &[AccountInfo]) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let mint_account_info = next_account_info(account_info_iter)?;
    let token_account_infos = account_info_iter.as_slice();
    check_program_account(mint_account_info.owner)?;

    let mut mint_data = mint_account_info.data.borrow_mut();
    let mut mint = PodStateWithExtensionsMut::<PodMint>::unpack(&mut mint_data)?;
    let extension = mint.get_extension_mut::<SlotReferenceFeeConfig>()?;

    for token_account_info in token_account_infos {
        match harvest_from_account(mint_account_info.key, token_account_info) {
            Ok(amount) => {
                extension.withheld_amount = u64::from(extension.withheld_amount)
                    .checked_add(amount)
                    .ok_or(TokenError::Overflow)?
                    .into();
            }
            Err(e) => {
                msg!("Error harvesting from {}: {}", token_account_info.key, e);
            }
        }
    }
    Ok(())
}

fn credit(
    mint_key: &Address,
    account_info: &AccountInfo,
    amount: u64,
    expected_owner: Option<&Address>,
) -> ProgramResult {
    check_program_account(account_info.owner)?;
    let mut data = account_info.data.borrow_mut();
    let account = PodStateWithExtensionsMut::<PodAccount>::unpack(&mut data)?;
    if account.base.mint != *mint_key {
        return Err(TokenError::MintMismatch.into());
    }
    if let Some(owner) = expected_owner {
        if account.base.owner != *owner {
            return Err(TokenError::SlotReferenceFeeInvalidSink.into());
        }
    }
    if account.base.is_frozen() {
        return Err(TokenError::AccountFrozen.into());
    }
    account.base.amount = u64::from(account.base.amount)
        .checked_add(amount)
        .ok_or(TokenError::Overflow)?
        .into();
    Ok(())
}

fn process_withdraw_withheld_tokens_from_mint(accounts: &[AccountInfo]) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let mint_account_info = next_account_info(account_info_iter)?;
    let sink_account_info = next_account_info(account_info_iter)?;
    let destination_account_info = next_account_info(account_info_iter)?;
    check_program_account(mint_account_info.owner)?;

    let (sink_share, destination_share, fee_destination) = {
        let mut mint_data = mint_account_info.data.borrow_mut();
        let mut mint = PodStateWithExtensionsMut::<PodMint>::unpack(&mut mint_data)?;
        let extension = mint.get_extension_mut::<SlotReferenceFeeConfig>()?;
        let withheld = u64::from(extension.withheld_amount);
        let (sink_share, destination_share) =
            extension.split(withheld).ok_or(TokenError::Overflow)?;
        extension.withheld_amount = 0.into();
        (sink_share, destination_share, extension.fee_destination)
    };

    if *destination_account_info.key != fee_destination {
        return Err(TokenError::SlotReferenceFeeDestinationMismatch.into());
    }
    if sink_account_info.key == destination_account_info.key {
        return Err(TokenError::SlotReferenceFeeInvalidSink.into());
    }

    let sink_owner_key = sink_owner();
    credit(
        mint_account_info.key,
        sink_account_info,
        sink_share,
        Some(&sink_owner_key),
    )?;
    credit(
        mint_account_info.key,
        destination_account_info,
        destination_share,
        None,
    )?;
    Ok(())
}

/// Called from the transfer path: if the mint carries the extension, register
/// this transfer as a reference in the current slot and return the fee, in
/// tokens, on `pre_fee_amount`. The mint must be writable.
pub(crate) fn reference_and_fee(
    mint_info: &AccountInfo,
    pre_fee_amount: u64,
) -> Result<u64, ProgramError> {
    {
        let mint_data = mint_info.try_borrow_data()?;
        let mint = PodStateWithExtensions::<PodMint>::unpack(&mint_data)?;
        if mint.get_extension::<SlotReferenceFeeConfig>().is_err() {
            return Ok(0);
        }
    }
    if !mint_info.is_writable {
        return Err(TokenError::SlotReferenceFeeMintNotWritable.into());
    }
    let mut mint_data = mint_info.try_borrow_mut_data()?;
    let mut mint = PodStateWithExtensionsMut::<PodMint>::unpack(&mut mint_data)?;
    let extension = mint.get_extension_mut::<SlotReferenceFeeConfig>()?;
    let n = extension.reference(Clock::get()?.slot);
    extension
        .calculate_fee(pre_fee_amount, n)
        .ok_or_else(|| TokenError::Overflow.into())
}

pub(crate) fn process_instruction(
    program_id: &Address,
    accounts: &[AccountInfo],
    input: &[u8],
) -> ProgramResult {
    check_program_account(program_id)?;

    match decode_instruction_type(input)? {
        SlotReferenceFeeInstruction::Initialize => {
            msg!("SlotReferenceFeeInstruction::Initialize");
            let data = decode_instruction_data::<InitializeInstructionData>(input)?;
            process_initialize(accounts, data)
        }
        SlotReferenceFeeInstruction::Set => {
            msg!("SlotReferenceFeeInstruction::Set");
            let data = decode_instruction_data::<SetInstructionData>(input)?;
            process_set(program_id, accounts, data)
        }
        SlotReferenceFeeInstruction::HarvestWithheldTokensToMint => {
            msg!("SlotReferenceFeeInstruction::HarvestWithheldTokensToMint");
            process_harvest_withheld_tokens_to_mint(accounts)
        }
        SlotReferenceFeeInstruction::WithdrawWithheldTokensFromMint => {
            msg!("SlotReferenceFeeInstruction::WithdrawWithheldTokensFromMint");
            process_withdraw_withheld_tokens_from_mint(accounts)
        }
    }
}
