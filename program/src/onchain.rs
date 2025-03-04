//! On-chain program invoke helper to perform on-chain `transfer_checked` with
//! correct accounts

use {
    crate::{
        extension::{transfer_fee, transfer_hook, StateWithExtensions},
        instruction,
        state::Mint,
    },
    solana_program::{
        account_info::AccountInfo, entrypoint::ProgramResult, instruction::Instruction,
        program::invoke_signed, program_error::ProgramError, pubkey::Pubkey,
    },
    spl_transfer_hook_interface::onchain::add_extra_accounts_for_execute_cpi,
};

/// Internal function to gather account infos and create instruction
#[allow(clippy::too_many_arguments)]
fn transfer_instruction_and_account_infos<'a>(
    token_program_id: &Pubkey,
    source_info: AccountInfo<'a>,
    mint_info: AccountInfo<'a>,
    destination_info: AccountInfo<'a>,
    authority_info: AccountInfo<'a>,
    additional_accounts: &[AccountInfo<'a>],
    amount: u64,
    decimals: u8,
    fee: Option<u64>,
) -> Result<(Instruction, Vec<AccountInfo<'a>>), ProgramError> {
    let mut cpi_account_infos = vec![
        source_info.clone(),
        mint_info.clone(),
        destination_info.clone(),
        authority_info.clone(),
    ];

    let mut multisig_signer_pubkeys = Vec::new();
    for info in additional_accounts.iter() {
        if info.is_signer {
            multisig_signer_pubkeys.push(info.key);
            cpi_account_infos.push(info.clone());
        }
    }

    let mut cpi_instruction = match fee {
        None => instruction::transfer_checked(
            token_program_id,
            source_info.key,
            mint_info.key,
            destination_info.key,
            authority_info.key,
            &multisig_signer_pubkeys,
            amount,
            decimals,
        )?,
        Some(fee) => transfer_fee::instruction::transfer_checked_with_fee(
            token_program_id,
            source_info.key,
            mint_info.key,
            destination_info.key,
            authority_info.key,
            &multisig_signer_pubkeys,
            amount,
            decimals,
            fee,
        )?,
    };

    // scope the borrowing to avoid a double-borrow during CPI
    {
        let mint_data = mint_info.try_borrow_data()?;
        let mint = StateWithExtensions::<Mint>::unpack(&mint_data)?;
        if let Some(program_id) = transfer_hook::get_program_id(&mint) {
            add_extra_accounts_for_execute_cpi(
                &mut cpi_instruction,
                &mut cpi_account_infos,
                &program_id,
                source_info,
                mint_info.clone(),
                destination_info,
                authority_info,
                amount,
                additional_accounts,
            )?;
        }
    }
    Ok((cpi_instruction, cpi_account_infos))
}

/// Internal function to reduce redundancy between the callers
#[allow(clippy::too_many_arguments)]
fn invoke_transfer_internal<'a>(
    token_program_id: &Pubkey,
    source_info: AccountInfo<'a>,
    mint_info: AccountInfo<'a>,
    destination_info: AccountInfo<'a>,
    authority_info: AccountInfo<'a>,
    additional_accounts: &[AccountInfo<'a>],
    amount: u64,
    decimals: u8,
    fee: Option<u64>,
    seeds: &[&[&[u8]]],
) -> ProgramResult {
    let (cpi_instruction, cpi_account_infos) = transfer_instruction_and_account_infos(
        token_program_id,
        source_info,
        mint_info,
        destination_info,
        authority_info,
        additional_accounts,
        amount,
        decimals,
        fee,
    )?;

    invoke_signed(&cpi_instruction, &cpi_account_infos, seeds)
}

/// Helper to CPI into token-2022 on-chain, looking through the additional
/// account infos to create the proper instruction with the proper account infos
#[allow(clippy::too_many_arguments)]
pub fn invoke_transfer_checked<'a>(
    token_program_id: &Pubkey,
    source_info: AccountInfo<'a>,
    mint_info: AccountInfo<'a>,
    destination_info: AccountInfo<'a>,
    authority_info: AccountInfo<'a>,
    additional_accounts: &[AccountInfo<'a>],
    amount: u64,
    decimals: u8,
    seeds: &[&[&[u8]]],
) -> ProgramResult {
    invoke_transfer_internal(
        token_program_id,
        source_info,
        mint_info,
        destination_info,
        authority_info,
        additional_accounts,
        amount,
        decimals,
        None,
        seeds,
    )
}

/// Helper to CPI into token-2022 on-chain, looking through the additional
/// account infos to create the proper instruction with the fee
/// and proper account infos
#[allow(clippy::too_many_arguments)]
pub fn invoke_transfer_checked_with_fee<'a>(
    token_program_id: &Pubkey,
    source_info: AccountInfo<'a>,
    mint_info: AccountInfo<'a>,
    destination_info: AccountInfo<'a>,
    authority_info: AccountInfo<'a>,
    additional_accounts: &[AccountInfo<'a>],
    amount: u64,
    decimals: u8,
    fee: u64,
    seeds: &[&[&[u8]]],
) -> ProgramResult {
    invoke_transfer_internal(
        token_program_id,
        source_info,
        mint_info,
        destination_info,
        authority_info,
        additional_accounts,
        amount,
        decimals,
        Some(fee),
        seeds,
    )
}

#[cfg(test)]
mod tests {
    use {
        super::*,
        crate::{
            extension::{
                transfer_hook::TransferHook, BaseStateWithExtensionsMut, ExtensionType,
                PodStateWithExtensionsMut,
            },
            pod::{PodCOption, PodMint},
        },
        solana_program::{instruction::AccountMeta, program_option::COption, program_pack::Pack},
        spl_pod::{optional_keys::OptionalNonZeroPubkey, primitives::PodBool},
        spl_tlv_account_resolution::{account::ExtraAccountMeta, state::ExtraAccountMetaList},
        spl_transfer_hook_interface::{
            get_extra_account_metas_address, instruction::ExecuteInstruction,
        },
        test_case::test_case,
    };

    fn setup_mint() -> Vec<u8> {
        let state = Mint {
            decimals: 10,
            is_initialized: true,
            supply: 100_000,
            mint_authority: COption::Some(Pubkey::new_unique()),
            freeze_authority: COption::None,
        };
        let mut data = vec![0u8; Mint::LEN];
        state.pack_into_slice(&mut data);
        data
    }

    fn setup_mint_with_transfer_hook(hook_program_id: Pubkey) -> Vec<u8> {
        let mint_len =
            ExtensionType::try_calculate_account_len::<Mint>(&[ExtensionType::TransferHook])
                .unwrap();
        let mut data = vec![0u8; mint_len];
        let mut mint =
            PodStateWithExtensionsMut::<PodMint>::unpack_uninitialized(&mut data).unwrap();

        let extension = mint.init_extension::<TransferHook>(true).unwrap();
        extension.program_id = OptionalNonZeroPubkey(hook_program_id);

        mint.base.mint_authority = PodCOption::some(Pubkey::new_unique());
        mint.base.decimals = 6;
        mint.base.supply = 100_000_000.into();
        mint.base.freeze_authority = PodCOption::none();
        mint.base.is_initialized = PodBool::from_bool(true);

        mint.init_account_type().unwrap();

        data
    }

    fn setup_validation_state(
        mint_key: &Pubkey,
        program_id: &Pubkey,
        extra_accounts: &[AccountMeta],
    ) -> (Pubkey, Vec<u8>) {
        let validation_key = get_extra_account_metas_address(mint_key, program_id);

        let extra_metas: Vec<ExtraAccountMeta> = extra_accounts
            .iter()
            .map(|meta| {
                ExtraAccountMeta::new_with_pubkey(&meta.pubkey, meta.is_signer, meta.is_writable)
                    .unwrap()
            })
            .collect();

        let size = ExtraAccountMetaList::size_of(extra_metas.len()).unwrap();
        let mut buffer = vec![0; size];
        ExtraAccountMetaList::init::<ExecuteInstruction>(&mut buffer, &extra_metas).unwrap();
        (validation_key, buffer)
    }

    // Parameterized test function
    #[test_case(false, false, false; "single signer")]
    #[test_case(false, true, false; "single signer with fee")]
    #[test_case(false, false, true; "single signer with transfer hook")]
    #[test_case(false, true, true; "single signer with fee and transfer hook")]
    #[test_case(true, false, false; "multisig")]
    #[test_case(true, true, false; "multisig with fee")]
    #[test_case(true, false, true; "multisig with transfer hook")]
    #[test_case(true, true, true; "multisig with fee and transfer_hook")]
    fn test_parameterized_invoke_fns(
        with_multisig: bool,
        with_fee: bool,
        with_transfer_hook: bool,
    ) {
        let token_program_id = crate::id();
        let source_key = Pubkey::new_unique();
        let mint_key = Pubkey::new_unique();
        let destination_key = Pubkey::new_unique();
        let authority_key = Pubkey::new_unique();

        let transfer_hook_program_id = Pubkey::new_unique();
        let extra_account1_key = Pubkey::new_unique();
        let extra_account2_key = Pubkey::new_unique();
        let extra_account3_key = Pubkey::new_unique();
        let extra_hook_account_metas = vec![
            AccountMeta::new(extra_account1_key, false),
            AccountMeta::new(extra_account2_key, false),
            AccountMeta::new_readonly(extra_account3_key, false),
        ];
        let (validation_key, mut validation_data) = setup_validation_state(
            &mint_key,
            &transfer_hook_program_id,
            &extra_hook_account_metas,
        );

        // Setup base account infos

        let mut source_lamports = 0;
        let source_owner = Pubkey::new_unique();
        let source_info = AccountInfo::new(
            &source_key,
            false,
            false,
            &mut source_lamports,
            &mut [],
            &source_owner,
            false,
            0,
        );

        let mut mint_lamports = 100;
        let mint_owner = Pubkey::new_unique();
        let mut mint_data = if with_transfer_hook {
            setup_mint_with_transfer_hook(transfer_hook_program_id)
        } else {
            setup_mint()
        };
        let mint_info = AccountInfo::new(
            &mint_key,
            false,
            false,
            &mut mint_lamports,
            &mut mint_data,
            &mint_owner,
            false,
            0,
        );

        let mut destination_lamports = 100;
        let destination_owner = Pubkey::new_unique();
        let destination_info = AccountInfo::new(
            &destination_key,
            false,
            false,
            &mut destination_lamports,
            &mut [],
            &destination_owner,
            false,
            0,
        );

        let authority_is_signer = !with_multisig; // Authority signs only if not multisig
        let mut authority_lamports = 100;
        let authority_owner = Pubkey::new_unique();
        let authority_info = AccountInfo::new(
            &authority_key,
            authority_is_signer,
            false,
            &mut authority_lamports,
            &mut [],
            &authority_owner,
            false,
            0,
        );

        let mut additional_accounts = vec![];

        // If with_multisig passed, add multisig account info

        let signer1_key = Pubkey::new_unique();
        let signer2_key = Pubkey::new_unique();
        let signer3_key = Pubkey::new_unique();
        let signer_keys = [signer1_key, signer2_key, signer3_key];

        let signer1_owner = Pubkey::new_unique();
        let signer2_owner = Pubkey::new_unique();
        let signer3_owner = Pubkey::new_unique();

        let mut signer1_lamports = 100;
        let mut signer2_lamports = 100;
        let mut signer3_lamports = 100;

        if with_multisig {
            let signer1_info = AccountInfo::new(
                &signer1_key,
                true,
                false,
                &mut signer1_lamports,
                &mut [],
                &signer1_owner,
                false,
                0,
            );

            let signer2_info = AccountInfo::new(
                &signer2_key,
                true,
                false,
                &mut signer2_lamports,
                &mut [],
                &signer2_owner,
                false,
                0,
            );

            let signer3_info = AccountInfo::new(
                &signer3_key,
                true,
                false,
                &mut signer3_lamports,
                &mut [],
                &signer3_owner,
                false,
                0,
            );

            additional_accounts.extend(vec![signer1_info, signer2_info, signer3_info]);
        };

        // If with_transfer_hook passed, add account info related to transfer hooks

        let hook_program_owner = Pubkey::new_unique();
        let extra_account1_owner = Pubkey::new_unique();
        let extra_account2_owner = Pubkey::new_unique();
        let extra_account3_owner = Pubkey::new_unique();

        let mut validation_lamports = 100;
        let mut hook_program_lamports = 100;
        let mut extra_account1_lamports = 100;
        let mut extra_account2_lamports = 100;
        let mut extra_account3_lamports = 100;

        if with_transfer_hook {
            let validation_info = AccountInfo::new(
                &validation_key,
                false,
                false,
                &mut validation_lamports,
                &mut validation_data,
                &transfer_hook_program_id,
                false,
                0,
            );

            let hook_program_info = AccountInfo::new(
                &transfer_hook_program_id,
                false,
                false,
                &mut hook_program_lamports,
                &mut [],
                &hook_program_owner,
                true,
                0,
            );

            let extra_account1_info = AccountInfo::new(
                &extra_account1_key,
                false,
                true,
                &mut extra_account1_lamports,
                &mut [],
                &extra_account1_owner,
                false,
                0,
            );

            let extra_account2_info = AccountInfo::new(
                &extra_account2_key,
                false,
                false,
                &mut extra_account2_lamports,
                &mut [],
                &extra_account2_owner,
                false,
                0,
            );

            let extra_account3_info = AccountInfo::new(
                &extra_account3_key,
                false,
                true,
                &mut extra_account3_lamports,
                &mut [],
                &extra_account3_owner,
                false,
                0,
            );

            additional_accounts.extend(vec![
                validation_info,
                hook_program_info,
                extra_account1_info,
                extra_account2_info,
                extra_account3_info,
            ]);
        };

        let (instruction, account_infos) = transfer_instruction_and_account_infos(
            &token_program_id,
            source_info.clone(),
            mint_info.clone(),
            destination_info.clone(),
            authority_info.clone(),
            &additional_accounts,
            200,
            6,
            with_fee.then_some(120),
        )
        .unwrap();
        let account_keys = account_infos
            .into_iter()
            .map(|info| *info.key)
            .collect::<Vec<_>>();

        // Calculate expected accounts
        let base_account_count = 4; // source, mint, destination, authority
        let multisig_account_count = if with_multisig { signer_keys.len() } else { 0 };
        let transfer_hook_account_count = 2; // validation account and program ID
        let extra_hook_account_count = extra_hook_account_metas.len();

        let mut expected_account_count = base_account_count;
        if with_multisig {
            expected_account_count += multisig_account_count;
        };
        if with_transfer_hook {
            expected_account_count += transfer_hook_account_count + extra_hook_account_count;
        }

        // Check instruction
        assert_eq!(instruction.program_id, token_program_id);
        assert_eq!(instruction.accounts.len(), expected_account_count);

        // Verify base account metas
        assert_eq!(instruction.accounts[0], AccountMeta::new(source_key, false));
        assert_eq!(
            instruction.accounts[1],
            AccountMeta::new_readonly(mint_key, false)
        );
        assert_eq!(
            instruction.accounts[2],
            AccountMeta::new(destination_key, false)
        );
        assert_eq!(
            instruction.accounts[3],
            AccountMeta::new_readonly(authority_key, authority_is_signer)
        );

        // Verify multisig signer metas if multisig
        if with_multisig {
            for (i, signer_key) in signer_keys.iter().enumerate() {
                assert_eq!(
                    instruction.accounts[4 + i],
                    AccountMeta::new_readonly(*signer_key, true),
                );
            }
        }

        // Verify transfer hook accounts
        let mut hook_accounts_start = base_account_count;
        if with_multisig {
            hook_accounts_start += multisig_account_count;
        }

        if with_transfer_hook {
            // Verify extra hook accounts first
            // these are added before the validation account
            for (i, extra_meta) in extra_hook_account_metas.iter().enumerate() {
                assert_eq!(instruction.accounts[hook_accounts_start + i], *extra_meta);
            }

            // Verify validation account - added after the extra accounts
            assert_eq!(
                instruction.accounts[hook_accounts_start + extra_hook_account_count],
                AccountMeta::new_readonly(validation_key, false),
            );

            // Verify program ID is included at the end
            assert_eq!(
                instruction.accounts[expected_account_count - 1],
                AccountMeta::new_readonly(transfer_hook_program_id, false),
            );
        }

        // Verify account keys match
        assert_eq!(account_keys.len(), expected_account_count);
        assert_eq!(account_keys[0], source_key);
        assert_eq!(account_keys[1], mint_key);
        assert_eq!(account_keys[2], destination_key);
        assert_eq!(account_keys[3], authority_key);

        // Verify multisig signers if multisig
        if with_multisig {
            for (i, signer_key) in signer_keys.iter().enumerate() {
                assert_eq!(account_keys[4 + i], *signer_key);
            }
        }

        if with_transfer_hook {
            // Verify extra hook account keys
            assert_eq!(account_keys[hook_accounts_start], extra_account1_key);
            assert_eq!(account_keys[hook_accounts_start + 1], extra_account2_key);
            assert_eq!(account_keys[hook_accounts_start + 2], extra_account3_key);

            // Verify validation account key
            assert_eq!(
                account_keys[hook_accounts_start + extra_hook_account_count],
                validation_key
            );

            // Verify program ID key
            assert_eq!(
                account_keys[expected_account_count - 1],
                transfer_hook_program_id
            );
        }
    }
}
