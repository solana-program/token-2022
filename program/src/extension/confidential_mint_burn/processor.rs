#[cfg(feature = "zk-ops")]
use {
    crate::{
        check_auditor_ciphertext,
        extension::confidential_mint_burn::verify_proof::{verify_burn_proof, verify_mint_proof},
        processor::BurnInstructionVariant,
    },
    spl_token_2022_interface::extension::permissioned_burn::PermissionedBurnConfig,
    spl_token_confidential_transfer_ciphertext_arithmetic as ciphertext_arithmetic,
};
use {
    crate::{extension::cpi_guard::in_cpi, processor::Processor},
    solana_account_info::{next_account_info, AccountInfo},
    solana_address::Address,
    solana_msg::msg,
    solana_program_error::{ProgramError, ProgramResult},
    solana_zk_elgamal_proof_interface::proof_data::{
        CiphertextCiphertextEqualityProofContext, CiphertextCiphertextEqualityProofData,
    },
    solana_zk_sdk_pod::encryption::{
        auth_encryption::PodAeCiphertext,
        elgamal::{PodElGamalCiphertext, PodElGamalPubkey},
    },
    spl_token_2022_interface::{
        check_program_account,
        error::TokenError,
        extension::{
            confidential_mint_burn::{
                instruction::{
                    BurnInstructionData, ConfidentialMintBurnInstruction, InitializeMintData,
                    MintInstructionData, RotateSupplyElGamalPubkeyData,
                    UpdateDecryptableSupplyData,
                },
                ConfidentialMintBurn,
            },
            confidential_transfer::{ConfidentialTransferAccount, ConfidentialTransferMint},
            cpi_guard::CpiGuard,
            immutable_owner::ImmutableOwner,
            non_transferable::{NonTransferable, NonTransferableAccount},
            pausable::PausableConfig,
            BaseStateWithExtensions, BaseStateWithExtensionsMut, PodStateWithExtensionsMut,
        },
        instruction::{decode_instruction_data, decode_instruction_type},
        pod::{PodAccount, PodMint},
    },
    spl_token_confidential_transfer_proof_extraction::instruction::verify_and_extract_context,
};

/// Processes an [`InitializeMint`] instruction.
fn process_initialize_mint(accounts: &[AccountInfo], data: &InitializeMintData) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let mint_info = next_account_info(account_info_iter)?;

    check_program_account(mint_info.owner)?;

    let mint_data = &mut mint_info.data.borrow_mut();
    let mut mint = PodStateWithExtensionsMut::<PodMint>::unpack_uninitialized(mint_data)?;
    let mint_burn_extension = mint.init_extension::<ConfidentialMintBurn>(true)?;

    mint_burn_extension.supply_elgamal_pubkey = data.supply_elgamal_pubkey;
    mint_burn_extension.decryptable_supply = data.decryptable_supply;

    Ok(())
}

/// Processes an [`RotateSupplyElGamal`] instruction.
#[cfg(feature = "zk-ops")]
fn process_rotate_supply_elgamal_pubkey(
    program_id: &Address,
    accounts: &[AccountInfo],
    data: &RotateSupplyElGamalPubkeyData,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let mint_info = next_account_info(account_info_iter)?;

    check_program_account(mint_info.owner)?;
    let mint_data = &mut mint_info.data.borrow_mut();
    let mut mint = PodStateWithExtensionsMut::<PodMint>::unpack(mint_data)?;
    let mint_authority = mint.base.mint_authority;
    let mint_burn_extension = mint.get_extension_mut::<ConfidentialMintBurn>()?;

    let proof_context = verify_and_extract_context::<
        CiphertextCiphertextEqualityProofData,
        CiphertextCiphertextEqualityProofContext,
    >(
        account_info_iter,
        data.proof_instruction_offset as i64,
        None,
    )?;

    let supply_elgamal_pubkey: Option<PodElGamalPubkey> =
        mint_burn_extension.supply_elgamal_pubkey.into();
    let Some(supply_elgamal_pubkey) = supply_elgamal_pubkey else {
        return Err(TokenError::InvalidState.into());
    };

    if !supply_elgamal_pubkey.eq(&proof_context.first_pubkey) {
        return Err(TokenError::ConfidentialTransferElGamalPubkeyMismatch.into());
    }
    if mint_burn_extension.confidential_supply != proof_context.first_ciphertext {
        return Err(ProgramError::InvalidInstructionData);
    }
    if mint_burn_extension.pending_burn != PodElGamalCiphertext::default() {
        return Err(TokenError::PendingBalanceNonZero.into());
    }

    let authority_info = next_account_info(account_info_iter)?;
    let authority_info_data_len = authority_info.data_len();
    let authority = mint_authority.ok_or(TokenError::NoAuthorityExists)?;

    Processor::validate_owner(
        program_id,
        &authority,
        authority_info,
        authority_info_data_len,
        account_info_iter.as_slice(),
    )?;

    mint_burn_extension.supply_elgamal_pubkey = proof_context.second_pubkey;
    mint_burn_extension.confidential_supply = proof_context.second_ciphertext;

    Ok(())
}

/// Processes an [`UpdateDecryptableSupply`] instruction.
fn process_update_decryptable_supply(
    program_id: &Address,
    accounts: &[AccountInfo],
    new_decryptable_supply: PodAeCiphertext,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let mint_info = next_account_info(account_info_iter)?;

    check_program_account(mint_info.owner)?;
    let mint_data = &mut mint_info.data.borrow_mut();
    let mut mint = PodStateWithExtensionsMut::<PodMint>::unpack(mint_data)?;
    let mint_authority = mint.base.mint_authority;
    let mint_burn_extension = mint.get_extension_mut::<ConfidentialMintBurn>()?;

    let authority_info = next_account_info(account_info_iter)?;
    let authority_info_data_len = authority_info.data_len();
    let authority = mint_authority.ok_or(TokenError::NoAuthorityExists)?;

    Processor::validate_owner(
        program_id,
        &authority,
        authority_info,
        authority_info_data_len,
        account_info_iter.as_slice(),
    )?;

    mint_burn_extension.decryptable_supply = new_decryptable_supply;

    Ok(())
}

/// Processes a [`ConfidentialMint`] instruction.
#[cfg(feature = "zk-ops")]
fn process_confidential_mint(
    program_id: &Address,
    accounts: &[AccountInfo],
    data: &MintInstructionData,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let token_account_info = next_account_info(account_info_iter)?;
    let mint_info = next_account_info(account_info_iter)?;

    check_program_account(mint_info.owner)?;
    let mint_data = &mut mint_info.data.borrow_mut();
    let mut mint = PodStateWithExtensionsMut::<PodMint>::unpack(mint_data)?;
    let mint_authority = mint.base.mint_authority;

    let auditor_elgamal_pubkey = mint
        .get_extension::<ConfidentialTransferMint>()?
        .auditor_elgamal_pubkey;
    if let Ok(extension) = mint.get_extension::<PausableConfig>() {
        if extension.paused.into() {
            return Err(TokenError::MintPaused.into());
        }
    }
    check_program_account(token_account_info.owner)?;
    let token_account_data = &mut token_account_info.data.borrow_mut();
    let mut token_account = PodStateWithExtensionsMut::<PodAccount>::unpack(token_account_data)?;
    // If the mint is non-transferable, the destination account must have
    // immutable ownership, consistent with `process_mint_to`.
    if mint.get_extension::<NonTransferable>().is_ok()
        && (token_account.get_extension::<ImmutableOwner>().is_err()
            || token_account
                .get_extension::<NonTransferableAccount>()
                .is_err())
    {
        return Err(TokenError::NonTransferableNeedsImmutableOwnership.into());
    }
    let mint_burn_extension = mint.get_extension_mut::<ConfidentialMintBurn>()?;

    let proof_context = verify_mint_proof(
        account_info_iter,
        data.equality_proof_instruction_offset,
        data.ciphertext_validity_proof_instruction_offset,
        data.range_proof_instruction_offset,
    )?;

    let authority_info = next_account_info(account_info_iter)?;
    let authority_info_data_len = authority_info.data_len();
    let authority = mint_authority.ok_or(TokenError::NoAuthorityExists)?;

    Processor::validate_owner(
        program_id,
        &authority,
        authority_info,
        authority_info_data_len,
        account_info_iter.as_slice(),
    )?;

    if token_account.base.is_frozen() {
        return Err(TokenError::AccountFrozen.into());
    }

    if token_account.base.mint != *mint_info.key {
        return Err(TokenError::MintMismatch.into());
    }

    if token_account.base.is_native() {
        return Err(TokenError::NativeNotSupported.into());
    }

    let confidential_transfer_account =
        token_account.get_extension_mut::<ConfidentialTransferAccount>()?;
    confidential_transfer_account.valid_as_destination()?;

    if proof_context.mint_pubkeys.destination != confidential_transfer_account.elgamal_pubkey {
        return Err(ProgramError::InvalidInstructionData);
    }

    if auditor_elgamal_pubkey.get() != Some(proof_context.mint_pubkeys.auditor) {
        return Err(TokenError::ConfidentialTransferElGamalPubkeyMismatch.into());
    }

    let proof_context_auditor_ciphertext_lo = proof_context
        .mint_amount_ciphertext_lo
        .try_extract_ciphertext(2)
        .map_err(TokenError::from)?;
    let proof_context_auditor_ciphertext_hi = proof_context
        .mint_amount_ciphertext_hi
        .try_extract_ciphertext(2)
        .map_err(TokenError::from)?;

    check_auditor_ciphertext(
        &data.mint_amount_auditor_ciphertext_lo,
        &data.mint_amount_auditor_ciphertext_hi,
        &proof_context_auditor_ciphertext_lo,
        &proof_context_auditor_ciphertext_hi,
    )?;

    confidential_transfer_account.pending_balance_lo = ciphertext_arithmetic::add(
        &confidential_transfer_account.pending_balance_lo,
        &proof_context
            .mint_amount_ciphertext_lo
            .try_extract_ciphertext(0)
            .map_err(TokenError::from)?,
    )
    .ok_or(TokenError::CiphertextArithmeticFailed)?;
    confidential_transfer_account.pending_balance_hi = ciphertext_arithmetic::add(
        &confidential_transfer_account.pending_balance_hi,
        &proof_context
            .mint_amount_ciphertext_hi
            .try_extract_ciphertext(0)
            .map_err(TokenError::from)?,
    )
    .ok_or(TokenError::CiphertextArithmeticFailed)?;

    confidential_transfer_account.increment_pending_balance_credit_counter()?;

    // update supply
    if mint_burn_extension.supply_elgamal_pubkey != proof_context.mint_pubkeys.supply {
        return Err(ProgramError::InvalidInstructionData);
    }
    let current_supply = mint_burn_extension.confidential_supply;
    mint_burn_extension.confidential_supply = ciphertext_arithmetic::add_with_lo_hi(
        &current_supply,
        &proof_context
            .mint_amount_ciphertext_lo
            .try_extract_ciphertext(1)
            .map_err(|_| ProgramError::InvalidAccountData)?,
        &proof_context
            .mint_amount_ciphertext_hi
            .try_extract_ciphertext(1)
            .map_err(|_| ProgramError::InvalidAccountData)?,
    )
    .ok_or(TokenError::CiphertextArithmeticFailed)?;

    // Check that the computed supply ciphertext is consistent with what was
    // actually used to generate the zkp on the client side.
    if mint_burn_extension.confidential_supply != proof_context.new_supply_ciphertext {
        return Err(TokenError::ConfidentialTransferBalanceMismatch.into());
    }

    mint_burn_extension.decryptable_supply = data.new_decryptable_supply;

    Ok(())
}

/// Processes a [`ConfidentialBurn`] instruction.
#[cfg(feature = "zk-ops")]
pub(crate) fn process_confidential_burn(
    program_id: &Address,
    accounts: &[AccountInfo],
    data: &BurnInstructionData,
    burn_variant: BurnInstructionVariant,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let token_account_info = next_account_info(account_info_iter)?;
    let mint_info = next_account_info(account_info_iter)?;

    check_program_account(mint_info.owner)?;
    let mint_data = &mut mint_info.data.borrow_mut();
    let mut mint = PodStateWithExtensionsMut::<PodMint>::unpack(mint_data)?;

    let auditor_elgamal_pubkey = mint
        .get_extension::<ConfidentialTransferMint>()?
        .auditor_elgamal_pubkey;
    if let Ok(extension) = mint.get_extension::<PausableConfig>() {
        if extension.paused.into() {
            return Err(TokenError::MintPaused.into());
        }
    }

    let proof_context = verify_burn_proof(
        account_info_iter,
        data.equality_proof_instruction_offset,
        data.ciphertext_validity_proof_instruction_offset,
        data.range_proof_instruction_offset,
    )?;

    let (permissioned_burn_authority_info, authority_info) = match burn_variant {
        BurnInstructionVariant::Permissioned => {
            let permissioned_burn_authority_info = next_account_info(account_info_iter)?;
            let authority_info = next_account_info(account_info_iter)?;
            (Some(permissioned_burn_authority_info), authority_info)
        }
        BurnInstructionVariant::Standard => (None, next_account_info(account_info_iter)?),
    };

    let permissioned_ext = mint.get_extension::<PermissionedBurnConfig>();
    let maybe_permissioned_burn_authority = permissioned_ext
        .as_ref()
        .ok()
        .and_then(|ext| Option::<Address>::from(ext.authority));
    match burn_variant {
        BurnInstructionVariant::Standard => {
            // Standard burns cannot be used when the permissioned burn
            // extension is present.
            if maybe_permissioned_burn_authority.is_some() {
                return Err(TokenError::InvalidInstruction.into());
            }
        }
        BurnInstructionVariant::Permissioned => {
            permissioned_ext.map_err(|_| TokenError::InvalidInstruction)?;

            let expected_burn_authority = maybe_permissioned_burn_authority.ok_or_else(|| {
                msg!("Permissioned burn authority is None; use the standard burn");
                TokenError::InvalidInstruction
            })?;

            // Pull the required extra signer from the accounts
            let approver_ai =
                permissioned_burn_authority_info.ok_or(ProgramError::NotEnoughAccountKeys)?;

            if !approver_ai.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }

            if *approver_ai.key != expected_burn_authority {
                return Err(ProgramError::InvalidAccountData);
            }
        }
    }

    let mint_burn_extension = mint.get_extension_mut::<ConfidentialMintBurn>()?;

    check_program_account(token_account_info.owner)?;
    let token_account_data = &mut token_account_info.data.borrow_mut();
    let mut token_account = PodStateWithExtensionsMut::<PodAccount>::unpack(token_account_data)?;

    let authority_info_data_len = authority_info.data_len();

    Processor::validate_owner(
        program_id,
        &token_account.base.owner,
        authority_info,
        authority_info_data_len,
        account_info_iter.as_slice(),
    )?;

    if let Ok(cpi_guard) = token_account.get_extension::<CpiGuard>() {
        // Blocks all cases where the authority has signed if CPI Guard is
        // enabled, including:
        // * the account is delegated to the owner
        // * the account owner is the permanent delegate
        if *authority_info.key == token_account.base.owner && cpi_guard.lock_cpi.into() && in_cpi()
        {
            return Err(TokenError::CpiGuardBurnBlocked.into());
        }
    }

    if token_account.base.is_frozen() {
        return Err(TokenError::AccountFrozen.into());
    }

    if token_account.base.mint != *mint_info.key {
        return Err(TokenError::MintMismatch.into());
    }

    let confidential_transfer_account =
        token_account.get_extension_mut::<ConfidentialTransferAccount>()?;
    confidential_transfer_account.valid_as_source()?;

    // Check that the source encryption public key is consistent with what was
    // actually used to generate the zkp.
    if proof_context.burn_pubkeys.source != confidential_transfer_account.elgamal_pubkey {
        return Err(TokenError::ConfidentialTransferElGamalPubkeyMismatch.into());
    }

    let proof_context_auditor_ciphertext_lo = proof_context
        .burn_amount_ciphertext_lo
        .try_extract_ciphertext(2)
        .map_err(TokenError::from)?;
    let proof_context_auditor_ciphertext_hi = proof_context
        .burn_amount_ciphertext_hi
        .try_extract_ciphertext(2)
        .map_err(TokenError::from)?;

    check_auditor_ciphertext(
        &data.burn_amount_auditor_ciphertext_lo,
        &data.burn_amount_auditor_ciphertext_hi,
        &proof_context_auditor_ciphertext_lo,
        &proof_context_auditor_ciphertext_hi,
    )?;

    let burn_amount_lo = &proof_context
        .burn_amount_ciphertext_lo
        .try_extract_ciphertext(0)
        .map_err(TokenError::from)?;
    let burn_amount_hi = &proof_context
        .burn_amount_ciphertext_hi
        .try_extract_ciphertext(0)
        .map_err(TokenError::from)?;

    let new_source_available_balance = ciphertext_arithmetic::subtract_with_lo_hi(
        &confidential_transfer_account.available_balance,
        burn_amount_lo,
        burn_amount_hi,
    )
    .ok_or(TokenError::CiphertextArithmeticFailed)?;

    // Check that the computed available balance is consistent with what was
    // actually used to generate the zkp on the client side.
    if new_source_available_balance != proof_context.remaining_balance_ciphertext {
        return Err(TokenError::ConfidentialTransferBalanceMismatch.into());
    }

    if auditor_elgamal_pubkey.get() != Some(proof_context.burn_pubkeys.auditor) {
        return Err(TokenError::ConfidentialTransferElGamalPubkeyMismatch.into());
    }

    confidential_transfer_account.available_balance = new_source_available_balance;
    confidential_transfer_account.decryptable_available_balance =
        data.new_decryptable_available_balance;

    // update supply
    if mint_burn_extension.supply_elgamal_pubkey != proof_context.burn_pubkeys.supply {
        return Err(ProgramError::InvalidInstructionData);
    }
    let pending_burn = mint_burn_extension.pending_burn;
    mint_burn_extension.pending_burn = ciphertext_arithmetic::add_with_lo_hi(
        &pending_burn,
        &proof_context
            .burn_amount_ciphertext_lo
            .try_extract_ciphertext(1)
            .map_err(|_| ProgramError::InvalidAccountData)?,
        &proof_context
            .burn_amount_ciphertext_hi
            .try_extract_ciphertext(1)
            .map_err(|_| ProgramError::InvalidAccountData)?,
    )
    .ok_or(TokenError::CiphertextArithmeticFailed)?;

    Ok(())
}

/// Processes a [`ApplyPendingBurn`] instruction.
#[cfg(feature = "zk-ops")]
fn process_apply_pending_burn(program_id: &Address, accounts: &[AccountInfo]) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let mint_info = next_account_info(account_info_iter)?;

    check_program_account(mint_info.owner)?;
    let mint_data = &mut mint_info.data.borrow_mut();
    let mut mint = PodStateWithExtensionsMut::<PodMint>::unpack(mint_data)?;
    let mint_authority = mint.base.mint_authority;
    let mint_burn_extension = mint.get_extension_mut::<ConfidentialMintBurn>()?;

    let authority_info = next_account_info(account_info_iter)?;
    let authority_info_data_len = authority_info.data_len();
    let authority = mint_authority.ok_or(TokenError::NoAuthorityExists)?;

    Processor::validate_owner(
        program_id,
        &authority,
        authority_info,
        authority_info_data_len,
        account_info_iter.as_slice(),
    )?;

    let current_supply = mint_burn_extension.confidential_supply;
    let pending_burn = mint_burn_extension.pending_burn;
    mint_burn_extension.confidential_supply =
        ciphertext_arithmetic::subtract(&current_supply, &pending_burn)
            .ok_or(TokenError::CiphertextArithmeticFailed)?;

    mint_burn_extension.pending_burn = PodElGamalCiphertext::default();

    Ok(())
}

#[allow(dead_code)]
pub(crate) fn process_instruction(
    program_id: &Address,
    accounts: &[AccountInfo],
    input: &[u8],
) -> ProgramResult {
    check_program_account(program_id)?;

    match decode_instruction_type(input)? {
        ConfidentialMintBurnInstruction::InitializeMint => {
            msg!("ConfidentialMintBurnInstruction::InitializeMint");
            let data = decode_instruction_data::<InitializeMintData>(input)?;
            process_initialize_mint(accounts, data)
        }
        ConfidentialMintBurnInstruction::RotateSupplyElGamalPubkey => {
            msg!("ConfidentialMintBurnInstruction::RotateSupplyElGamal");
            #[cfg(feature = "zk-ops")]
            {
                let data = decode_instruction_data::<RotateSupplyElGamalPubkeyData>(input)?;
                process_rotate_supply_elgamal_pubkey(program_id, accounts, data)
            }
            #[cfg(not(feature = "zk-ops"))]
            Err(ProgramError::InvalidInstructionData)
        }
        ConfidentialMintBurnInstruction::UpdateDecryptableSupply => {
            msg!("ConfidentialMintBurnInstruction::UpdateDecryptableSupply");
            let data = decode_instruction_data::<UpdateDecryptableSupplyData>(input)?;
            process_update_decryptable_supply(program_id, accounts, data.new_decryptable_supply)
        }
        ConfidentialMintBurnInstruction::Mint => {
            msg!("ConfidentialMintBurnInstruction::ConfidentialMint");
            #[cfg(feature = "zk-ops")]
            {
                let data = decode_instruction_data::<MintInstructionData>(input)?;
                process_confidential_mint(program_id, accounts, data)
            }
            #[cfg(not(feature = "zk-ops"))]
            Err(ProgramError::InvalidInstructionData)
        }
        ConfidentialMintBurnInstruction::Burn => {
            msg!("ConfidentialMintBurnInstruction::ConfidentialBurn");
            #[cfg(feature = "zk-ops")]
            {
                let data = decode_instruction_data::<BurnInstructionData>(input)?;
                process_confidential_burn(
                    program_id,
                    accounts,
                    data,
                    BurnInstructionVariant::Standard,
                )
            }
            #[cfg(not(feature = "zk-ops"))]
            Err(ProgramError::InvalidInstructionData)
        }
        ConfidentialMintBurnInstruction::ApplyPendingBurn => {
            msg!("ConfidentialMintBurnInstruction::ApplyPendingBurn");
            #[cfg(feature = "zk-ops")]
            {
                process_apply_pending_burn(program_id, accounts)
            }
            #[cfg(not(feature = "zk-ops"))]
            Err(ProgramError::InvalidInstructionData)
        }
    }
}
#[cfg(all(test, feature = "zk-ops"))]
mod tests {
    use {
        super::*,
        solana_address::Address,
        spl_token_2022_interface::{
            extension::{
                non_transferable::NonTransferableAccount, BaseStateWithExtensionsMut,
                ExtensionType, PodStateWithExtensionsMut,
            },
            pod::{PodAccount, PodCOption, PodMint},
            state::AccountState,
        },
    };

    /// Build a minimal, initialized `PodMint` account buffer that has
    /// `ConfidentialTransferMint` and `NonTransferable` extensions.
    /// `ConfidentialMintBurn` is intentionally absent so the negative test
    /// returns our guard error before reaching the extension-not-found error.
    fn make_non_transferable_mint(owner_key: &Address) -> (Address, Vec<u8>) {
        let mint_key = Address::new_unique();
        let mint_size = ExtensionType::try_calculate_account_len::<PodMint>(&[
            ExtensionType::NonTransferable,
            ExtensionType::ConfidentialTransferMint,
            ExtensionType::ConfidentialMintBurn,
        ])
        .unwrap();
        let mut data = vec![0u8; mint_size];
        {
            let mut state =
                PodStateWithExtensionsMut::<PodMint>::unpack_uninitialized(&mut data).unwrap();
            state.init_extension::<NonTransferable>(true).unwrap();
            // ConfidentialTransferMint must exist for `process_confidential_mint`
            // to proceed past the auditor-pubkey read.
            state
                .init_extension::<ConfidentialTransferMint>(true)
                .unwrap();
            state.init_extension::<ConfidentialMintBurn>(true).unwrap();
            state.base.decimals = 2;
            state.base.mint_authority = PodCOption::some(*owner_key);
            state.base.is_initialized = true.into();
            state.init_account_type().unwrap();
        }
        (mint_key, data)
    }

    /// Build a `PodAccount` buffer with optional `ImmutableOwner` extension.
    fn make_token_account(
        mint_key: &Address,
        owner_key: &Address,
        with_immutable_owner: bool,
    ) -> (Address, Vec<u8>) {
        let token_account_key = Address::new_unique();
        let mut extension_types = vec![ExtensionType::NonTransferableAccount];
        if with_immutable_owner {
            extension_types.push(ExtensionType::ImmutableOwner);
        }
        let account_size =
            ExtensionType::try_calculate_account_len::<PodAccount>(&extension_types).unwrap();
        let mut data = vec![0u8; account_size];
        {
            let mut state =
                PodStateWithExtensionsMut::<PodAccount>::unpack_uninitialized(&mut data).unwrap();
            state
                .init_extension::<NonTransferableAccount>(true)
                .unwrap();
            if with_immutable_owner {
                state.init_extension::<ImmutableOwner>(true).unwrap();
            }
            state.base.mint = *mint_key;
            state.base.owner = *owner_key;
            state.base.state = AccountState::Initialized as u8;
            state.init_account_type().unwrap();
        }
        (token_account_key, data)
    }

    /// Calling `process_confidential_mint` on a non-transferable mint when the
    /// destination account lacks `ImmutableOwner` must be rejected with
    /// `NonTransferableNeedsImmutableOwnership`.  Without this guard an
    /// attacker could confidential-mint into a mutable-owner account and then
    /// call `SetAuthority` to take control of the non-transferable tokens.
    #[test]
    fn test_confidential_mint_non_transferable_requires_immutable_owner() {
        let program_id = crate::id();
        let owner_key = Address::new_unique();

        let (mint_key, mut mint_data) = make_non_transferable_mint(&owner_key);
        let (token_account_key, mut token_account_data) =
            make_token_account(&mint_key, &owner_key, false /* no ImmutableOwner */);

        let mut mint_lamports = 0u64;
        let mut token_lamports = 0u64;

        let mint_info = AccountInfo::new(
            &mint_key,
            false,
            true,
            &mut mint_lamports,
            &mut mint_data,
            &program_id,
            false,
        );
        let token_account_info = AccountInfo::new(
            &token_account_key,
            false,
            true,
            &mut token_lamports,
            &mut token_account_data,
            &program_id,
            false,
        );

        // Encode a minimal ConfidentialMint instruction data (all-zero proof
        // fields; the guard fires before proof verification so the values do
        // not matter for this test).
        let data = MintInstructionData {
            new_decryptable_supply: PodAeCiphertext::default(),
            mint_amount_auditor_ciphertext_lo: PodElGamalCiphertext::default(),
            mint_amount_auditor_ciphertext_hi: PodElGamalCiphertext::default(),
            equality_proof_instruction_offset: 0,
            ciphertext_validity_proof_instruction_offset: 0,
            range_proof_instruction_offset: 0,
        };

        // Only the token-account and mint accounts are needed; the guard
        // returns before the authority or proof accounts are accessed.
        let accounts = [token_account_info, mint_info];

        assert_eq!(
            process_confidential_mint(&program_id, &accounts, &data),
            Err(TokenError::NonTransferableNeedsImmutableOwnership.into()),
        );
    }

    /// When the destination account *does* carry `ImmutableOwner`, the guard
    /// must not block the instruction.  The instruction will still fail
    /// further along (proof verification), but the
    /// `NonTransferableNeedsImmutableOwnership` error must never be returned.
    #[test]
    fn test_confidential_mint_non_transferable_with_immutable_owner_passes_guard() {
        let program_id = crate::id();
        let owner_key = Address::new_unique();

        let (mint_key, mut mint_data) = make_non_transferable_mint(&owner_key);
        let (token_account_key, mut token_account_data) =
            make_token_account(&mint_key, &owner_key, true /* with ImmutableOwner */);

        let mut mint_lamports = 0u64;
        let mut token_lamports = 0u64;

        let mint_info = AccountInfo::new(
            &mint_key,
            false,
            true,
            &mut mint_lamports,
            &mut mint_data,
            &program_id,
            false,
        );
        let token_account_info = AccountInfo::new(
            &token_account_key,
            false,
            true,
            &mut token_lamports,
            &mut token_account_data,
            &program_id,
            false,
        );

        let data = MintInstructionData {
            new_decryptable_supply: PodAeCiphertext::default(),
            mint_amount_auditor_ciphertext_lo: PodElGamalCiphertext::default(),
            mint_amount_auditor_ciphertext_hi: PodElGamalCiphertext::default(),
            equality_proof_instruction_offset: 0,
            ciphertext_validity_proof_instruction_offset: 0,
            range_proof_instruction_offset: 0,
        };

        let accounts = [token_account_info, mint_info];

        let result = process_confidential_mint(&program_id, &accounts, &data);

        // The guard must not trigger: `NonTransferableNeedsImmutableOwnership`
        // must not be returned.  The instruction will fail later (missing proof
        // context accounts), but that is expected and unrelated to this guard.
        assert_ne!(
            result,
            Err(TokenError::NonTransferableNeedsImmutableOwnership.into()),
        );
    }
}
