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
        program::invoke_signed, pubkey::Pubkey,
    },
    spl_transfer_hook_interface::onchain::add_extra_accounts_for_execute_cpi,
};

/// Internal function that uses dependency injection for testing
#[allow(clippy::too_many_arguments)]
fn _invoke_transfer_internal<'a, F>(
    invoker: F,
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
) -> ProgramResult
where
    F: Fn(&Instruction, &[AccountInfo<'a>], &[&[&[u8]]]) -> ProgramResult,
{
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

    invoker(&cpi_instruction, &cpi_account_infos, seeds)
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
    _invoke_transfer_internal(
        invoke_signed,
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
    _invoke_transfer_internal(
        invoke_signed,
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
        solana_program::{
            account_info::AccountInfo,
            entrypoint::ProgramResult,
            instruction::{AccountMeta, Instruction},
            program_option::COption,
            program_pack::Pack,
            pubkey::Pubkey,
        },
        std::cell::RefCell,
    };

    struct MockInvoker {
        captured_instruction: Option<Instruction>,
        captured_account_keys: Option<Vec<Pubkey>>,
        return_result: ProgramResult,
    }

    impl MockInvoker {
        fn new(return_result: ProgramResult) -> Self {
            MockInvoker {
                captured_instruction: None,
                captured_account_keys: None,
                return_result,
            }
        }

        fn invoke(
            &mut self,
            instruction: &Instruction,
            account_infos: &[AccountInfo],
        ) -> ProgramResult {
            self.captured_instruction = Some(instruction.clone());
            self.captured_account_keys = Some(account_infos.iter().map(|ai| *ai.key).collect());
            self.return_result.clone()
        }
    }

    // Setup mint data
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

    // Parameterized test function
    fn test_invoke_fns_with_params(is_multisig: bool, with_fee: bool) {
        let token_program_id = crate::id();
        let source_key = Pubkey::new_unique();
        let mint_key = Pubkey::new_unique();
        let destination_key = Pubkey::new_unique();
        let authority_key = Pubkey::new_unique();

        // Setup base accounts
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
        let mut mint_data = setup_mint();
        let mint_owner = Pubkey::new_unique();
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

        let authority_is_signer = !is_multisig; // Authority signs only if not multisig
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

        let signer1_key = Pubkey::new_unique();
        let signer1_owner = Pubkey::new_unique();
        let mut signer1_lamports = 100;

        let signer2_key = Pubkey::new_unique();
        let signer2_owner = Pubkey::new_unique();
        let mut signer2_lamports = 100;

        let signer3_key = Pubkey::new_unique();
        let signer3_owner = Pubkey::new_unique();
        let mut signer3_lamports = 100;

        let signer_keys = [signer1_key, signer2_key, signer3_key];

        let additional_accounts = if !is_multisig {
            vec![]
        } else {
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

            vec![signer1_info, signer2_info, signer3_info]
        };

        let mock_invoker = RefCell::new(MockInvoker::new(Ok(())));
        let invoker_fn =
            |instruction: &Instruction, account_infos: &[AccountInfo], _seeds: &[&[&[u8]]]| {
                mock_invoker.borrow_mut().invoke(instruction, account_infos)
            };

        let fee = if with_fee { Some(120) } else { None };

        let result = _invoke_transfer_internal(
            invoker_fn,
            &token_program_id,
            source_info.clone(),
            mint_info.clone(),
            destination_info.clone(),
            authority_info.clone(),
            &additional_accounts,
            200,
            6,
            fee,
            &[],
        );
        assert!(result.is_ok());

        let expected_account_count = if is_multisig { 7 } else { 4 };

        let mock_invoker = mock_invoker.borrow();
        let instruction = mock_invoker.captured_instruction.as_ref().unwrap();
        let account_keys = mock_invoker.captured_account_keys.as_ref().unwrap();

        // Check instruction
        assert_eq!(instruction.program_id, token_program_id,);
        assert_eq!(instruction.accounts.len(), expected_account_count,);

        // Verify base account metas
        assert_eq!(instruction.accounts[0], AccountMeta::new(source_key, false),);
        assert_eq!(
            instruction.accounts[1],
            AccountMeta::new_readonly(mint_key, false),
        );
        assert_eq!(
            instruction.accounts[2],
            AccountMeta::new(destination_key, false),
        );
        assert_eq!(
            instruction.accounts[3],
            AccountMeta::new_readonly(authority_key, authority_is_signer),
        );

        // Verify additional signer metas if multisig
        if is_multisig {
            for (i, signer_key) in signer_keys.iter().enumerate() {
                assert_eq!(
                    instruction.accounts[4 + i],
                    AccountMeta::new_readonly(*signer_key, true),
                );
            }
        }

        // Verify account keys
        assert_eq!(account_keys.len(), expected_account_count);
        assert_eq!(account_keys[0], source_key);
        assert_eq!(account_keys[1], mint_key);
        assert_eq!(account_keys[2], destination_key);
        assert_eq!(account_keys[3], authority_key);

        if is_multisig {
            for (i, signer_key) in signer_keys.iter().enumerate() {
                assert_eq!(account_keys[4 + i], *signer_key);
            }
        }
    }

    #[test]
    fn test_invoke_transfer_checked_single_signer_authority() {
        test_invoke_fns_with_params(false, false);
    }

    #[test]
    fn test_invoke_transfer_checked_multisig() {
        test_invoke_fns_with_params(true, false);
    }

    #[test]
    fn test_transfer_checked_with_fee_single_signer_authority() {
        test_invoke_fns_with_params(false, true);
    }

    #[test]
    fn test_transfer_checked_with_fee_multisig() {
        test_invoke_fns_with_params(true, true);
    }
}
