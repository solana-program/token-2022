use {
    pinocchio_system::instructions::CreateAccountAllowPrefund,
    solana_account_view::{next_account_view, AccountView},
    solana_address::Address,
    solana_instruction_view::{cpi::Signer, seeds},
    solana_msg::msg,
    solana_program_error::{ProgramError, ProgramResult},
    solana_rent::Rent,
    solana_sysvar::Sysvar,
    solana_zk_elgamal_proof_interface::proof_data::pubkey_validity::{
        PubkeyValidityProofContext, PubkeyValidityProofData,
    },
    spl_elgamal_registry_interface::{
        get_elgamal_registry_address_and_bump_seed,
        instruction::RegistryInstruction,
        state::{ElGamalRegistry, ELGAMAL_REGISTRY_ACCOUNT_LEN},
        REGISTRY_ADDRESS_SEED,
    },
    spl_token_confidential_transfer_proof_extraction::instruction::verify_and_extract_context,
};

/// Processes `CreateRegistry` instruction
pub fn process_create_registry_account(
    program_id: &Address,
    accounts: &mut [AccountView],
    proof_instruction_offset: i64,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter_mut();
    let elgamal_registry_account_info = next_account_view(account_info_iter)?;
    let wallet_account_info = next_account_view(account_info_iter)?;
    let _system_program_info = next_account_view(account_info_iter)?;

    if !wallet_account_info.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // zero-knowledge proof certifies that the supplied ElGamal public key is valid
    let proof_context = verify_and_extract_context::<
        PubkeyValidityProofData,
        PubkeyValidityProofContext,
    >(account_info_iter, proof_instruction_offset, None)?;

    let (elgamal_registry_account_address, bump) =
        get_elgamal_registry_address_and_bump_seed(wallet_account_info.address(), program_id);
    if elgamal_registry_account_address != *elgamal_registry_account_info.address() {
        msg!("Error: ElGamal registry account address does not match seed derivation");
        return Err(ProgramError::InvalidSeeds);
    }

    let bump_seed = [bump];
    let elgamal_registry_account_seeds = seeds!(
        REGISTRY_ADDRESS_SEED,
        wallet_account_info.address().as_ref(),
        &bump_seed
    );
    let rent = Rent::get()?;

    create_pda_account(
        &rent,
        ELGAMAL_REGISTRY_ACCOUNT_LEN,
        program_id,
        elgamal_registry_account_info,
        Signer::from(&elgamal_registry_account_seeds),
    )?;

    let elgamal_registry_account_data = &mut elgamal_registry_account_info.try_borrow_mut()?;
    let elgamal_registry_account =
        bytemuck::try_from_bytes_mut::<ElGamalRegistry>(elgamal_registry_account_data)
            .map_err(|_| ProgramError::InvalidArgument)?;
    elgamal_registry_account.owner = *wallet_account_info.address();
    elgamal_registry_account.elgamal_pubkey = proof_context.pubkey;

    Ok(())
}

/// Processes `UpdateRegistry` instruction
pub fn process_update_registry_account(
    program_id: &Address,
    accounts: &mut [AccountView],
    proof_instruction_offset: i64,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter_mut();
    let elgamal_registry_account_info = next_account_view(account_info_iter)?;

    // Note: Storing the owner of the account so borrow checker doesn't complain about
    // multiple borrows of `elgamal_registry_account_info`.
    let elgamal_registry_account_owner = *elgamal_registry_account_info.owner();

    let elgamal_registry_account_data = &mut elgamal_registry_account_info.try_borrow_mut()?;
    let elgamal_registry_account =
        bytemuck::try_from_bytes_mut::<ElGamalRegistry>(elgamal_registry_account_data)
            .map_err(|_| ProgramError::InvalidArgument)?;

    // zero-knowledge proof certifies that the supplied ElGamal public key is valid
    let proof_context = verify_and_extract_context::<
        PubkeyValidityProofData,
        PubkeyValidityProofContext,
    >(account_info_iter, proof_instruction_offset, None)?;

    let owner_info = next_account_view(account_info_iter)?;
    validate_registry_owner(owner_info, &elgamal_registry_account.owner)?;
    validate_program_owner(&elgamal_registry_account_owner, program_id)?;

    elgamal_registry_account.elgamal_pubkey = proof_context.pubkey;
    Ok(())
}

/// Instruction processor
pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    input: &[u8],
) -> ProgramResult {
    let instruction = RegistryInstruction::unpack(input)?;
    match instruction {
        RegistryInstruction::CreateRegistry {
            proof_instruction_offset,
        } => {
            msg!("ElGamalRegistryInstruction::CreateRegistry");
            process_create_registry_account(program_id, accounts, proof_instruction_offset as i64)
        }
        RegistryInstruction::UpdateRegistry {
            proof_instruction_offset,
        } => {
            msg!("ElGamalRegistryInstruction::UpdateRegistry");
            process_update_registry_account(program_id, accounts, proof_instruction_offset as i64)
        }
    }
}

fn validate_registry_owner(owner_info: &AccountView, expected_owner: &Address) -> ProgramResult {
    if expected_owner != owner_info.address() {
        return Err(ProgramError::InvalidAccountOwner);
    }
    if !owner_info.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    Ok(())
}

fn validate_program_owner(owner: &Address, program_id: &Address) -> ProgramResult {
    if owner != program_id {
        return Err(ProgramError::InvalidAccountOwner);
    }
    Ok(())
}

/// Allocate ElGamal registry account using Program Derived Address for the
/// given seeds
#[inline(always)]
pub fn create_pda_account(
    rent: &Rent,
    space: usize,
    owner: &Address,
    new_pda_account: &AccountView,
    new_pda_signer: Signer,
) -> ProgramResult {
    let required_lamports = rent
        .minimum_balance(space)
        .saturating_sub(new_pda_account.lamports());

    if required_lamports > 0 {
        return Err(ProgramError::AccountNotRentExempt);
    }

    CreateAccountAllowPrefund {
        to: new_pda_account,
        owner,
        space: space as u64,
        funding: None,
    }
    .invoke_signed(&[new_pda_signer])
}
