mod program_test;
use {
    program_test::{
        derive_confidential_keys, keypair_clone, ConfidentialTokenAccountMeta, TestContext,
        TokenContext,
    },
    solana_instruction_error::InstructionError,
    solana_keypair::Keypair,
    solana_program_pack::Pack,
    solana_program_test::{
        tokio::{self, sync::Mutex},
        ProgramTest,
    },
    solana_pubkey::Pubkey,
    solana_rent::Rent,
    solana_signer::Signer,
    solana_system_interface::instruction as system_instruction,
    solana_transaction::Transaction,
    solana_transaction_error::TransactionError,
    solana_transaction_error::TransportError,
    solana_zk_sdk::zk_elgamal_proof_program::build_pubkey_validity_proof_data,
    spl_elgamal_registry::state::ELGAMAL_REGISTRY_ACCOUNT_LEN,
    spl_instruction_padding_interface::instruction::wrap_instruction,
    spl_token_2022_interface::{
        error::TokenError,
        extension::{
            confidential_transfer::{
                self, ConfidentialTransferAccount, DEFAULT_MAXIMUM_PENDING_BALANCE_CREDIT_COUNTER,
            },
            cpi_guard::{self, CpiGuard},
            BaseStateWithExtensions, ExtensionType,
        },
        instruction::{self, AuthorityType},
        state::Account,
    },
    spl_token_client::{
        client::ProgramBanksClientProcessTransaction,
        token::{ExtensionInitializationParams, Token, TokenError as TokenClientError},
        zk_proofs::confidential_transfer::WithdrawAccountInfo,
    },
    spl_token_confidential_transfer_proof_extraction::instruction::ProofLocation,
    spl_token_confidential_transfer_proof_generation::withdraw::WithdrawProofData,
    std::sync::Arc,
};

// set up a bank and bank client with spl token 2022, the instruction padder and
// the elgamal registry
// also creates a token with no extensions and inits two token accounts
async fn make_context() -> TestContext {
    // TODO this may be removed when we upgrade to a solana version with a fixed
    // `get_stack_height()` stub
    if std::env::var("BPF_OUT_DIR").is_err() && std::env::var("SBF_OUT_DIR").is_err() {
        panic!("CpiGuard tests MUST be invoked with `cargo test-sbf`, NOT `cargo test --feature test-sbf`. \
                In a non-BPF context, `get_stack_height()` always returns 0, and all tests WILL fail.");
    }

    let mut program_test = ProgramTest::new("spl_token_2022", spl_token_2022_interface::id(), None);

    program_test.add_program(
        "spl_instruction_padding",
        spl_instruction_padding_interface::id(),
        None,
    );
    program_test.add_program("spl_elgamal_registry", spl_elgamal_registry::id(), None);

    let program_context = program_test.start_with_context().await;
    let program_context = Arc::new(Mutex::new(program_context));

    TestContext {
        context: program_context,
        token_context: None,
    }
}

async fn make_context_with_new_mint() -> TestContext {
    let mut test_context = make_context().await;

    test_context.init_token_with_mint(vec![]).await.unwrap();
    let token_context = test_context.token_context.as_ref().unwrap();

    token_context
        .token
        .create_auxiliary_token_account_with_extension_space(
            &token_context.alice,
            &token_context.alice.pubkey(),
            vec![ExtensionType::CpiGuard],
        )
        .await
        .unwrap();

    token_context
        .token
        .create_auxiliary_token_account(&token_context.bob, &token_context.bob.pubkey())
        .await
        .unwrap();

    test_context
}

async fn make_context_with_native_mint(amount: u64) -> TestContext {
    let mut test_context = make_context().await;

    test_context.init_token_with_native_mint().await.unwrap();
    let token_context = test_context.token_context.as_ref().unwrap();

    token_context
        .token
        .wrap_with_mutable_ownership(
            &token_context.alice.pubkey(),
            &token_context.alice.pubkey(),
            amount,
            &[&token_context.alice],
        )
        .await
        .unwrap();

    token_context
        .token
        .wrap_with_mutable_ownership(
            &token_context.bob.pubkey(),
            &token_context.bob.pubkey(),
            amount,
            &[&token_context.bob],
        )
        .await
        .unwrap();

    test_context
}

async fn make_context_with_confidential_mint() -> TestContext {
    let mut test_context = make_context().await;

    test_context
        .init_token_with_mint(vec![
            ExtensionInitializationParams::ConfidentialTransferMint {
                authority: None,
                auto_approve_new_accounts: true,
                auditor_elgamal_pubkey: None,
            },
        ])
        .await
        .unwrap();

    test_context
}

fn client_error(token_error: TokenError) -> TokenClientError {
    TokenClientError::Client(Box::new(TransportError::TransactionError(
        TransactionError::InstructionError(0, InstructionError::Custom(token_error as u32)),
    )))
}

#[tokio::test]
async fn test_cpi_guard_enable_disable() {
    let context = make_context_with_new_mint().await;
    let TokenContext {
        token, alice, bob, ..
    } = context.token_context.unwrap();

    // enable guard properly
    token
        .enable_cpi_guard(&alice.pubkey(), &alice.pubkey(), &[&alice])
        .await
        .unwrap();

    // guard is enabled
    let alice_state = token.get_account_info(&alice.pubkey()).await.unwrap();
    let extension = alice_state.get_extension::<CpiGuard>().unwrap();
    assert!(bool::from(extension.lock_cpi));

    // attempt to disable through cpi. this fails
    let error = token
        .process_ixs(
            &[wrap_instruction(
                spl_instruction_padding_interface::id(),
                cpi_guard::instruction::disable_cpi_guard(
                    &spl_token_2022_interface::id(),
                    &alice.pubkey(),
                    &alice.pubkey(),
                    &[],
                )
                .unwrap(),
                vec![],
                0,
            )
            .unwrap()],
            &[&alice],
        )
        .await
        .unwrap_err();
    assert_eq!(error, client_error(TokenError::CpiGuardSettingsLocked));

    // guard remains enabled
    let alice_state = token.get_account_info(&alice.pubkey()).await.unwrap();
    let extension = alice_state.get_extension::<CpiGuard>().unwrap();
    assert!(bool::from(extension.lock_cpi));

    // disable guard properly
    token
        .disable_cpi_guard(&alice.pubkey(), &alice.pubkey(), &[&alice])
        .await
        .unwrap();

    // guard is disabled
    let alice_state = token.get_account_info(&alice.pubkey()).await.unwrap();
    let extension = alice_state.get_extension::<CpiGuard>().unwrap();
    assert!(!bool::from(extension.lock_cpi));

    // attempt to enable through cpi. this fails
    let error = token
        .process_ixs(
            &[wrap_instruction(
                spl_instruction_padding_interface::id(),
                cpi_guard::instruction::enable_cpi_guard(
                    &spl_token_2022_interface::id(),
                    &alice.pubkey(),
                    &alice.pubkey(),
                    &[],
                )
                .unwrap(),
                vec![],
                0,
            )
            .unwrap()],
            &[&alice],
        )
        .await
        .unwrap_err();
    assert_eq!(error, client_error(TokenError::CpiGuardSettingsLocked));

    // guard remains disabled
    let alice_state = token.get_account_info(&alice.pubkey()).await.unwrap();
    let extension = alice_state.get_extension::<CpiGuard>().unwrap();
    assert!(!bool::from(extension.lock_cpi));

    // enable works with realloc
    token
        .reallocate(
            &bob.pubkey(),
            &bob.pubkey(),
            &[ExtensionType::CpiGuard],
            &[&bob],
        )
        .await
        .unwrap();

    token
        .enable_cpi_guard(&bob.pubkey(), &bob.pubkey(), &[&bob])
        .await
        .unwrap();

    let bob_state = token.get_account_info(&bob.pubkey()).await.unwrap();
    let extension = bob_state.get_extension::<CpiGuard>().unwrap();
    assert!(bool::from(extension.lock_cpi));
}

#[tokio::test]
async fn test_cpi_guard_transfer() {
    let context = make_context_with_new_mint().await;
    let TokenContext {
        token,
        token_unchecked,
        mint_authority,
        alice,
        bob,
        ..
    } = context.token_context.unwrap();

    let mk_transfer = |authority, do_checked| {
        wrap_instruction(
            spl_instruction_padding_interface::id(),
            if do_checked {
                instruction::transfer_checked(
                    &spl_token_2022_interface::id(),
                    &alice.pubkey(),
                    token.get_address(),
                    &bob.pubkey(),
                    &authority,
                    &[],
                    1,
                    9,
                )
                .unwrap()
            } else {
                #[allow(deprecated)]
                instruction::transfer(
                    &spl_token_2022_interface::id(),
                    &alice.pubkey(),
                    &bob.pubkey(),
                    &authority,
                    &[],
                    1,
                )
                .unwrap()
            },
            vec![],
            0,
        )
        .unwrap()
    };

    let mut amount = 100;
    token
        .mint_to(
            &alice.pubkey(),
            &mint_authority.pubkey(),
            amount,
            &[&mint_authority],
        )
        .await
        .unwrap();

    for do_checked in [true, false] {
        let token_obj = if do_checked { &token } else { &token_unchecked };
        token_obj
            .enable_cpi_guard(&alice.pubkey(), &alice.pubkey(), &[&alice])
            .await
            .unwrap();

        // transfer works normally with cpi guard enabled
        token_obj
            .transfer(
                &alice.pubkey(),
                &bob.pubkey(),
                &alice.pubkey(),
                1,
                &[&alice],
            )
            .await
            .unwrap();
        amount -= 1;

        let alice_state = token_obj.get_account_info(&alice.pubkey()).await.unwrap();
        assert_eq!(alice_state.base.amount, amount);

        // user-auth cpi transfer with cpi guard doesn't work
        let error = token_obj
            .process_ixs(&[mk_transfer(alice.pubkey(), do_checked)], &[&alice])
            .await
            .unwrap_err();
        assert_eq!(error, client_error(TokenError::CpiGuardTransferBlocked));

        let alice_state = token_obj.get_account_info(&alice.pubkey()).await.unwrap();
        assert_eq!(alice_state.base.amount, amount);

        // delegate-auth cpi transfer to self does not work
        token_obj
            .approve(
                &alice.pubkey(),
                &alice.pubkey(),
                &alice.pubkey(),
                1,
                &[&alice],
            )
            .await
            .unwrap();

        let error = token_obj
            .process_ixs(&[mk_transfer(alice.pubkey(), do_checked)], &[&alice])
            .await
            .unwrap_err();
        assert_eq!(error, client_error(TokenError::CpiGuardTransferBlocked));

        let alice_state = token_obj.get_account_info(&alice.pubkey()).await.unwrap();
        assert_eq!(alice_state.base.amount, amount);

        // delegate-auth cpi transfer with cpi guard works
        token_obj
            .approve(
                &alice.pubkey(),
                &bob.pubkey(),
                &alice.pubkey(),
                1,
                &[&alice],
            )
            .await
            .unwrap();

        token_obj
            .process_ixs(&[mk_transfer(bob.pubkey(), do_checked)], &[&bob])
            .await
            .unwrap();
        amount -= 1;

        let alice_state = token_obj.get_account_info(&alice.pubkey()).await.unwrap();
        assert_eq!(alice_state.base.amount, amount);

        // transfer still works through cpi with cpi guard off
        token_obj
            .disable_cpi_guard(&alice.pubkey(), &alice.pubkey(), &[&alice])
            .await
            .unwrap();

        token_obj
            .process_ixs(&[mk_transfer(alice.pubkey(), do_checked)], &[&alice])
            .await
            .unwrap();
        amount -= 1;

        let alice_state = token_obj.get_account_info(&alice.pubkey()).await.unwrap();
        assert_eq!(alice_state.base.amount, amount);
    }
}

#[tokio::test]
async fn test_cpi_guard_burn() {
    let context = make_context_with_new_mint().await;
    let TokenContext {
        token,
        token_unchecked,
        mint_authority,
        alice,
        bob,
        ..
    } = context.token_context.unwrap();

    let mk_burn = |authority, do_checked| {
        wrap_instruction(
            spl_instruction_padding_interface::id(),
            if do_checked {
                instruction::burn_checked(
                    &spl_token_2022_interface::id(),
                    &alice.pubkey(),
                    token.get_address(),
                    &authority,
                    &[],
                    1,
                    9,
                )
                .unwrap()
            } else {
                instruction::burn(
                    &spl_token_2022_interface::id(),
                    &alice.pubkey(),
                    token.get_address(),
                    &authority,
                    &[],
                    1,
                )
                .unwrap()
            },
            vec![],
            0,
        )
        .unwrap()
    };

    let mut amount = 100;
    token
        .mint_to(
            &alice.pubkey(),
            &mint_authority.pubkey(),
            amount,
            &[&mint_authority],
        )
        .await
        .unwrap();

    for do_checked in [true, false] {
        let token_obj = if do_checked { &token } else { &token_unchecked };
        token_obj
            .enable_cpi_guard(&alice.pubkey(), &alice.pubkey(), &[&alice])
            .await
            .unwrap();

        // burn works normally with cpi guard enabled
        token_obj
            .burn(&alice.pubkey(), &alice.pubkey(), 1, &[&alice])
            .await
            .unwrap();
        amount -= 1;

        let alice_state = token_obj.get_account_info(&alice.pubkey()).await.unwrap();
        assert_eq!(alice_state.base.amount, amount);

        // user-auth cpi burn with cpi guard doesn't work
        let error = token_obj
            .process_ixs(&[mk_burn(alice.pubkey(), do_checked)], &[&alice])
            .await
            .unwrap_err();
        assert_eq!(error, client_error(TokenError::CpiGuardBurnBlocked));

        let alice_state = token_obj.get_account_info(&alice.pubkey()).await.unwrap();
        assert_eq!(alice_state.base.amount, amount);

        // delegate-auth cpi burn by self does not work
        token_obj
            .approve(
                &alice.pubkey(),
                &alice.pubkey(),
                &alice.pubkey(),
                1,
                &[&alice],
            )
            .await
            .unwrap();

        let error = token_obj
            .process_ixs(&[mk_burn(alice.pubkey(), do_checked)], &[&alice])
            .await
            .unwrap_err();
        assert_eq!(error, client_error(TokenError::CpiGuardBurnBlocked));

        let alice_state = token_obj.get_account_info(&alice.pubkey()).await.unwrap();
        assert_eq!(alice_state.base.amount, amount);

        // delegate-auth cpi burn with cpi guard works
        token_obj
            .approve(
                &alice.pubkey(),
                &bob.pubkey(),
                &alice.pubkey(),
                1,
                &[&alice],
            )
            .await
            .unwrap();

        token_obj
            .process_ixs(&[mk_burn(bob.pubkey(), do_checked)], &[&bob])
            .await
            .unwrap();
        amount -= 1;

        let alice_state = token_obj.get_account_info(&alice.pubkey()).await.unwrap();
        assert_eq!(alice_state.base.amount, amount);

        // burn still works through cpi with cpi guard off
        token_obj
            .disable_cpi_guard(&alice.pubkey(), &alice.pubkey(), &[&alice])
            .await
            .unwrap();

        token_obj
            .process_ixs(&[mk_burn(alice.pubkey(), do_checked)], &[&alice])
            .await
            .unwrap();
        amount -= 1;

        let alice_state = token_obj.get_account_info(&alice.pubkey()).await.unwrap();
        assert_eq!(alice_state.base.amount, amount);
    }
}

#[tokio::test]
async fn test_cpi_guard_approve() {
    let context = make_context_with_new_mint().await;
    let TokenContext {
        token,
        token_unchecked,
        alice,
        bob,
        ..
    } = context.token_context.unwrap();

    let mk_approve = |do_checked| {
        wrap_instruction(
            spl_instruction_padding_interface::id(),
            if do_checked {
                instruction::approve_checked(
                    &spl_token_2022_interface::id(),
                    &alice.pubkey(),
                    token.get_address(),
                    &bob.pubkey(),
                    &alice.pubkey(),
                    &[],
                    1,
                    9,
                )
                .unwrap()
            } else {
                instruction::approve(
                    &spl_token_2022_interface::id(),
                    &alice.pubkey(),
                    &bob.pubkey(),
                    &alice.pubkey(),
                    &[],
                    1,
                )
                .unwrap()
            },
            vec![],
            0,
        )
        .unwrap()
    };

    for do_checked in [true, false] {
        let token_obj = if do_checked { &token } else { &token_unchecked };
        token_obj
            .enable_cpi_guard(&alice.pubkey(), &alice.pubkey(), &[&alice])
            .await
            .unwrap();

        // approve works normally with cpi guard enabled
        token_obj
            .approve(
                &alice.pubkey(),
                &bob.pubkey(),
                &alice.pubkey(),
                1,
                &[&alice],
            )
            .await
            .unwrap();

        token_obj
            .revoke(&alice.pubkey(), &alice.pubkey(), &[&alice])
            .await
            .unwrap();

        // approve doesn't work through cpi
        let error = token_obj
            .process_ixs(&[mk_approve(do_checked)], &[&alice])
            .await
            .unwrap_err();
        assert_eq!(error, client_error(TokenError::CpiGuardApproveBlocked));

        // approve still works through cpi with cpi guard off
        token_obj
            .disable_cpi_guard(&alice.pubkey(), &alice.pubkey(), &[&alice])
            .await
            .unwrap();

        // refresh the blockhash
        token_obj.get_new_latest_blockhash().await.unwrap();
        token_obj
            .process_ixs(&[mk_approve(do_checked)], &[&alice])
            .await
            .unwrap();

        token_obj
            .revoke(&alice.pubkey(), &alice.pubkey(), &[&alice])
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn test_cpi_guard_unwrap_lamports() {
    let mut amount = 100;
    let total_amount = amount + Rent::default().minimum_balance(Account::get_packed_len());

    let context = make_context_with_native_mint(total_amount).await;
    let TokenContext {
        token, alice, bob, ..
    } = context.token_context.unwrap();

    let unwrap_lamports = [wrap_instruction(
        spl_instruction_padding_interface::id(),
        instruction::unwrap_lamports(
            &spl_token_2022_interface::id(),
            &alice.pubkey(),
            &bob.pubkey(),
            &alice.pubkey(),
            &[],
            Some(1),
        )
        .unwrap(),
        vec![],
        0,
    )
    .unwrap()];

    token
        .reallocate(
            &alice.pubkey(),
            &alice.pubkey(),
            &[ExtensionType::CpiGuard],
            &[&alice],
        )
        .await
        .unwrap();

    token
        .enable_cpi_guard(&alice.pubkey(), &alice.pubkey(), &[&alice])
        .await
        .unwrap();

    // unwrap lamports works normally with cpi guard enabled
    token
        .unwrap_lamports(
            &alice.pubkey(),
            &bob.pubkey(),
            &alice.pubkey(),
            Some(1),
            &[&alice],
        )
        .await
        .unwrap();
    amount -= 1;

    let alice_state = token.get_account_info(&alice.pubkey()).await.unwrap();
    assert_eq!(alice_state.base.amount, amount);

    // user-auth cpi unwrap lamport with cpi guard doesn't work
    let error = token
        .process_ixs(&unwrap_lamports, &[&alice])
        .await
        .unwrap_err();
    assert_eq!(error, client_error(TokenError::CpiGuardTransferBlocked));

    let alice_state = token.get_account_info(&alice.pubkey()).await.unwrap();
    assert_eq!(alice_state.base.amount, amount);

    // unwrap lamports still works through cpi with cpi guard off
    token
        .disable_cpi_guard(&alice.pubkey(), &alice.pubkey(), &[&alice])
        .await
        .unwrap();

    // refresh the blockhash
    token.get_new_latest_blockhash().await.unwrap();

    token
        .process_ixs(&unwrap_lamports, &[&alice])
        .await
        .unwrap();
    amount -= 1;

    let alice_state = token.get_account_info(&alice.pubkey()).await.unwrap();
    assert_eq!(alice_state.base.amount, amount);
}

#[tokio::test]
async fn test_cpi_guard_withdraw_excess_lamports() {
    let context = make_context_with_new_mint().await;
    let program_context = context.context.clone();
    let TokenContext {
        token, alice, bob, ..
    } = context.token_context.unwrap();

    let withdraw_excess_lamports = [wrap_instruction(
        spl_instruction_padding_interface::id(),
        instruction::withdraw_excess_lamports(
            &spl_token_2022_interface::id(),
            &alice.pubkey(),
            &bob.pubkey(),
            &alice.pubkey(),
            &[],
        )
        .unwrap(),
        vec![],
        0,
    )
    .unwrap()];

    token
        .enable_cpi_guard(&alice.pubkey(), &alice.pubkey(), &[&alice])
        .await
        .unwrap();

    {
        let context = program_context.lock().await;
        let instructions = vec![system_instruction::transfer(
            &context.payer.pubkey(),
            &alice.pubkey(),
            1,
        )];
        let tx = Transaction::new_signed_with_payer(
            &instructions,
            Some(&context.payer.pubkey()),
            &[&context.payer],
            context.last_blockhash,
        );
        context.banks_client.process_transaction(tx).await.unwrap();
    }

    let error = token
        .process_ixs(&withdraw_excess_lamports, &[&alice])
        .await
        .expect_err("expected CPI withdraw_excess_lamports to be blocked by CPI Guard");
    assert_eq!(error, client_error(TokenError::CpiGuardTransferBlocked));
}

async fn make_close_test_account<S: Signer>(
    token: &Token<ProgramBanksClientProcessTransaction>,
    owner: &S,
    authority: Option<Pubkey>,
) -> Pubkey {
    let account = Keypair::new();

    token
        .create_auxiliary_token_account_with_extension_space(
            &account,
            &owner.pubkey(),
            vec![ExtensionType::CpiGuard],
        )
        .await
        .unwrap();

    if authority.is_some() {
        token
            .set_authority(
                &account.pubkey(),
                &owner.pubkey(),
                authority.as_ref(),
                AuthorityType::CloseAccount,
                &[owner],
            )
            .await
            .unwrap();
    }

    token
        .enable_cpi_guard(&account.pubkey(), &owner.pubkey(), &[owner])
        .await
        .unwrap();

    account.pubkey()
}

#[tokio::test]
async fn test_cpi_guard_close_account() {
    let context = make_context_with_new_mint().await;
    let TokenContext {
        token, alice, bob, ..
    } = context.token_context.unwrap();

    let mk_close = |account, destination, authority| {
        wrap_instruction(
            spl_instruction_padding_interface::id(),
            instruction::close_account(
                &spl_token_2022_interface::id(),
                &account,
                &destination,
                &authority,
                &[],
            )
            .unwrap(),
            vec![],
            0,
        )
        .unwrap()
    };

    // test closing through owner and closing through close authority
    // the result should be the same eitehr way
    for maybe_close_authority in [None, Some(bob.pubkey())] {
        let authority = if maybe_close_authority.is_none() {
            &alice
        } else {
            &bob
        };

        // closing normally works
        let account = make_close_test_account(&token, &alice, maybe_close_authority).await;
        token
            .close_account(&account, &bob.pubkey(), &authority.pubkey(), &[authority])
            .await
            .unwrap();

        // cpi close with guard enabled fails if lamports diverted to third party
        let account = make_close_test_account(&token, &alice, maybe_close_authority).await;
        let error = token
            .process_ixs(
                &[mk_close(account, bob.pubkey(), authority.pubkey())],
                &[authority],
            )
            .await
            .unwrap_err();
        assert_eq!(error, client_error(TokenError::CpiGuardCloseAccountBlocked));

        // but close succeeds if lamports are returned to owner
        token
            .process_ixs(
                &[mk_close(account, alice.pubkey(), authority.pubkey())],
                &[authority],
            )
            .await
            .unwrap();

        // close still works through cpi when guard disabled
        let account = make_close_test_account(&token, &alice, maybe_close_authority).await;
        token
            .disable_cpi_guard(&account, &alice.pubkey(), &[&alice])
            .await
            .unwrap();

        token
            .process_ixs(
                &[mk_close(account, bob.pubkey(), authority.pubkey())],
                &[authority],
            )
            .await
            .unwrap();
    }
}

#[derive(Copy, Clone, Debug, PartialEq)]
enum SetAuthTest {
    ChangeOwner,
    AddCloseAuth,
    ChangeCloseAuth,
    RemoveCloseAuth,
}

#[tokio::test]
async fn test_cpi_guard_set_authority() {
    let context = make_context_with_new_mint().await;
    let TokenContext {
        token, alice, bob, ..
    } = context.token_context.unwrap();

    // the behavior of cpi guard and close authority is so complicated that its best
    // to test all cases exhaustively
    let mut states = vec![];
    for action in [
        SetAuthTest::ChangeOwner,
        SetAuthTest::AddCloseAuth,
        SetAuthTest::ChangeCloseAuth,
        SetAuthTest::RemoveCloseAuth,
    ] {
        for enable_cpi_guard in [true, false] {
            for do_in_cpi in [true, false] {
                states.push((action, enable_cpi_guard, do_in_cpi));
            }
        }
    }

    for state in states {
        let (action, enable_cpi_guard, do_in_cpi) = state;

        // make a new account
        let account = Keypair::new();
        token
            .create_auxiliary_token_account_with_extension_space(
                &account,
                &alice.pubkey(),
                vec![ExtensionType::CpiGuard],
            )
            .await
            .unwrap();

        // turn on cpi guard if we are testing that case
        // all actions with cpi guard off should succeed unconditionally
        // so half of these tests are backwards compat checks
        if enable_cpi_guard {
            token
                .enable_cpi_guard(&account.pubkey(), &alice.pubkey(), &[&alice])
                .await
                .unwrap();
        }

        // if we are changing or removing close auth, we need to have one to
        // change/remove
        if action == SetAuthTest::ChangeCloseAuth || action == SetAuthTest::RemoveCloseAuth {
            token
                .set_authority(
                    &account.pubkey(),
                    &alice.pubkey(),
                    Some(&bob.pubkey()),
                    AuthorityType::CloseAccount,
                    &[&alice],
                )
                .await
                .unwrap();
        }

        // this produces the token instruction we want to execute
        let (current_authority, new_authority) = match action {
            SetAuthTest::ChangeOwner | SetAuthTest::AddCloseAuth => {
                (keypair_clone(&alice), Some(bob.pubkey()))
            }
            SetAuthTest::ChangeCloseAuth => (keypair_clone(&bob), Some(alice.pubkey())),
            SetAuthTest::RemoveCloseAuth => (keypair_clone(&bob), None),
        };
        let token_instruction = instruction::set_authority(
            &spl_token_2022_interface::id(),
            &account.pubkey(),
            new_authority.as_ref(),
            if action == SetAuthTest::ChangeOwner {
                AuthorityType::AccountOwner
            } else {
                AuthorityType::CloseAccount
            },
            &current_authority.pubkey(),
            &[],
        )
        .unwrap();

        // this wraps it or doesn't based on the test case
        let instruction = if do_in_cpi {
            wrap_instruction(
                spl_instruction_padding_interface::id(),
                token_instruction,
                vec![],
                0,
            )
            .unwrap()
        } else {
            token_instruction
        };

        // and here we go
        let result = token
            .process_ixs(&[instruction], &[&current_authority])
            .await;

        // truth table for our cases
        match (action, enable_cpi_guard, do_in_cpi) {
            // all actions succeed with cpi guard off
            (_, false, _) => result.unwrap(),
            // ownership cannot be transferred with guard
            (SetAuthTest::ChangeOwner, true, false) => assert_eq!(
                result.unwrap_err(),
                client_error(TokenError::CpiGuardOwnerChangeBlocked)
            ),
            // all other actions succeed outside cpi with guard
            (_, true, false) => result.unwrap(),
            // removing a close authority succeeds in cpi with guard
            (SetAuthTest::RemoveCloseAuth, true, true) => result.unwrap(),
            // changing owner, adding close, or changing close all fail in cpi with guard
            (_, true, true) => assert_eq!(
                result.unwrap_err(),
                client_error(TokenError::CpiGuardSetAuthorityBlocked)
            ),
        }
    }
}

#[tokio::test]
async fn test_cpi_guard_confidential_deposit() {
    let context = make_context_with_confidential_mint().await;
    let TokenContext {
        token,
        mint_authority,
        alice,
        decimals,
        ..
    } = context.token_context.unwrap();

    let alice_meta = ConfidentialTokenAccountMeta::new(&token, &alice, None, false, false).await;
    let alice_account = alice_meta.token_account;

    token
        .reallocate(
            &alice_account,
            &alice.pubkey(),
            &[ExtensionType::CpiGuard],
            &[&alice],
        )
        .await
        .unwrap();

    let mut amount = 100;
    token
        .mint_to(
            &alice_account,
            &mint_authority.pubkey(),
            amount,
            &[&mint_authority],
        )
        .await
        .unwrap();

    let deposit = [wrap_instruction(
        spl_instruction_padding_interface::id(),
        confidential_transfer::instruction::deposit(
            &spl_token_2022_interface::id(),
            &alice_account,
            token.get_address(),
            1,
            decimals,
            &alice.pubkey(),
            &[],
        )
        .unwrap(),
        vec![],
        0,
    )
    .unwrap()];

    token
        .enable_cpi_guard(&alice_account, &alice.pubkey(), &[&alice])
        .await
        .unwrap();

    // deposit works normally with cpi guard enabled
    token
        .confidential_transfer_deposit(&alice_account, &alice.pubkey(), 1, decimals, &[&alice])
        .await
        .unwrap();
    amount -= 1;

    let alice_state = token.get_account_info(&alice_account).await.unwrap();
    assert_eq!(alice_state.base.amount, amount);

    // user-auth cpi deposit with cpi guard doesn't work
    let error = token.process_ixs(&deposit, &[&alice]).await.unwrap_err();
    assert_eq!(error, client_error(TokenError::CpiGuardTransferBlocked));

    let alice_state = token.get_account_info(&alice_account).await.unwrap();
    assert_eq!(alice_state.base.amount, amount);

    // deposit still works through cpi with cpi guard off
    token
        .disable_cpi_guard(&alice_account, &alice.pubkey(), &[&alice])
        .await
        .unwrap();

    token.process_ixs(&deposit, &[&alice]).await.unwrap();
    amount -= 1;

    let alice_state = token.get_account_info(&alice_account).await.unwrap();
    assert_eq!(alice_state.base.amount, amount);
}

#[tokio::test]
async fn test_cpi_guard_confidential_withdraw() {
    let context = make_context_with_confidential_mint().await;
    let TokenContext {
        token,
        mint_authority,
        alice,
        decimals,
        ..
    } = context.token_context.unwrap();

    let alice_meta = ConfidentialTokenAccountMeta::new_with_tokens(
        &token,
        &alice,
        None,
        false,
        false,
        &mint_authority,
        100,
        decimals,
    )
    .await;
    let alice_account = alice_meta.token_account;

    token
        .reallocate(
            &alice_account,
            &alice.pubkey(),
            &[ExtensionType::CpiGuard],
            &[&alice],
        )
        .await
        .unwrap();

    token
        .enable_cpi_guard(&alice_account, &alice.pubkey(), &[&alice])
        .await
        .unwrap();

    // withdraw works normally with cpi guard enabled
    let mut amount = 0;
    token
        .confidential_transfer_withdraw(
            &alice_account,
            &alice.pubkey(),
            None,
            None,
            1,
            decimals,
            None,
            &alice_meta.elgamal_keypair,
            &alice_meta.aes_key,
            &[&alice],
        )
        .await
        .unwrap();
    amount += 1;

    let alice_state = token.get_account_info(&alice_account).await.unwrap();
    assert_eq!(alice_state.base.amount, amount);

    // the cpi withdraw takes its proofs from context state accounts
    let extension = alice_state
        .get_extension::<ConfidentialTransferAccount>()
        .unwrap();
    let withdraw_account_info = WithdrawAccountInfo::new(extension);
    let WithdrawProofData {
        equality_proof_data,
        range_proof_data,
    } = withdraw_account_info
        .generate_proof_data(1, &alice_meta.elgamal_keypair, &alice_meta.aes_key)
        .unwrap();
    let new_decryptable_available_balance = withdraw_account_info
        .new_decryptable_available_balance(1, &alice_meta.aes_key)
        .unwrap();

    let equality_proof_context_account = Keypair::new();
    let range_proof_context_account = Keypair::new();

    token
        .confidential_transfer_create_context_state_account(
            &equality_proof_context_account.pubkey(),
            &alice.pubkey(),
            &equality_proof_data,
            &[&equality_proof_context_account],
        )
        .await
        .unwrap();

    token
        .confidential_transfer_create_context_state_account(
            &range_proof_context_account.pubkey(),
            &alice.pubkey(),
            &range_proof_data,
            &[&range_proof_context_account],
        )
        .await
        .unwrap();

    let withdraw = [wrap_instruction(
        spl_instruction_padding_interface::id(),
        confidential_transfer::instruction::inner_withdraw(
            &spl_token_2022_interface::id(),
            &alice_account,
            token.get_address(),
            1,
            decimals,
            &new_decryptable_available_balance.into(),
            &alice.pubkey(),
            &[],
            ProofLocation::ContextStateAccount(&equality_proof_context_account.pubkey()),
            ProofLocation::ContextStateAccount(&range_proof_context_account.pubkey()),
        )
        .unwrap(),
        vec![],
        0,
    )
    .unwrap()];

    // user-auth cpi withdraw with cpi guard doesn't work
    let error = token.process_ixs(&withdraw, &[&alice]).await.unwrap_err();
    assert_eq!(error, client_error(TokenError::CpiGuardTransferBlocked));

    let alice_state = token.get_account_info(&alice_account).await.unwrap();
    assert_eq!(alice_state.base.amount, amount);

    // withdraw still works through cpi with cpi guard off
    token
        .disable_cpi_guard(&alice_account, &alice.pubkey(), &[&alice])
        .await
        .unwrap();

    token.process_ixs(&withdraw, &[&alice]).await.unwrap();
    amount += 1;

    let alice_state = token.get_account_info(&alice_account).await.unwrap();
    assert_eq!(alice_state.base.amount, amount);
}

#[tokio::test]
async fn test_cpi_guard_confidential_configure_account() {
    let context = make_context_with_confidential_mint().await;
    let TokenContext {
        token, alice, bob, ..
    } = context.token_context.unwrap();

    let mk_configure_account = |owner: &Keypair| {
        let (elgamal_keypair, aes_key) = derive_confidential_keys(owner).unwrap();
        let proof_data = build_pubkey_validity_proof_data(&elgamal_keypair).unwrap();
        let mut instructions = confidential_transfer::instruction::configure_account(
            &spl_token_2022_interface::id(),
            &owner.pubkey(),
            token.get_address(),
            &aes_key.encrypt(0).into(),
            DEFAULT_MAXIMUM_PENDING_BALANCE_CREDIT_COUNTER,
            &owner.pubkey(),
            &[],
            ProofLocation::InstructionOffset(1.try_into().unwrap(), &proof_data),
        )
        .unwrap();
        instructions[0] = wrap_instruction(
            spl_instruction_padding_interface::id(),
            instructions[0].clone(),
            vec![],
            0,
        )
        .unwrap();
        instructions
    };

    for owner in [&alice, &bob] {
        token
            .create_auxiliary_token_account_with_extension_space(
                owner,
                &owner.pubkey(),
                vec![
                    ExtensionType::CpiGuard,
                    ExtensionType::ConfidentialTransferAccount,
                ],
            )
            .await
            .unwrap();

        token
            .enable_cpi_guard(&owner.pubkey(), &owner.pubkey(), &[owner])
            .await
            .unwrap();
    }

    // user-auth cpi configure with cpi guard doesn't work
    let error = token
        .process_ixs(&mk_configure_account(&alice), &[&alice])
        .await
        .unwrap_err();
    assert_eq!(
        error,
        client_error(TokenError::CpiGuardConfigureAccountBlocked)
    );

    let alice_state = token.get_account_info(&alice.pubkey()).await.unwrap();
    assert!(alice_state
        .get_extension::<ConfidentialTransferAccount>()
        .is_err());

    // configure works normally with cpi guard enabled
    let (elgamal_keypair, aes_key) = derive_confidential_keys(&alice).unwrap();
    token
        .confidential_transfer_configure_token_account(
            &alice.pubkey(),
            &alice.pubkey(),
            None,
            None,
            &elgamal_keypair,
            &aes_key,
            &[&alice],
        )
        .await
        .unwrap();

    let alice_state = token.get_account_info(&alice.pubkey()).await.unwrap();
    assert!(alice_state
        .get_extension::<ConfidentialTransferAccount>()
        .is_ok());

    // configure still works through cpi with cpi guard off
    token
        .disable_cpi_guard(&bob.pubkey(), &bob.pubkey(), &[&bob])
        .await
        .unwrap();

    token
        .process_ixs(&mk_configure_account(&bob), &[&bob])
        .await
        .unwrap();

    let bob_state = token.get_account_info(&bob.pubkey()).await.unwrap();
    assert!(bob_state
        .get_extension::<ConfidentialTransferAccount>()
        .is_ok());
}

#[tokio::test]
async fn test_cpi_guard_confidential_configure_account_with_registry() {
    let context = make_context_with_confidential_mint().await;
    let TokenContext { token, alice, .. } = context.token_context.unwrap();

    let alice_account_keypair = Keypair::new();
    let alice_token_account = alice_account_keypair.pubkey();
    let (elgamal_keypair, _) = derive_confidential_keys(&alice).unwrap();

    // create ElGamal registry
    let ctx = context.context.lock().await;
    let proof_data = build_pubkey_validity_proof_data(&elgamal_keypair).unwrap();
    let proof_location = ProofLocation::InstructionOffset(1.try_into().unwrap(), &proof_data);

    let elgamal_registry_address = spl_elgamal_registry::get_elgamal_registry_address(
        &alice.pubkey(),
        &spl_elgamal_registry::id(),
    );

    let rent = ctx.banks_client.get_rent().await.unwrap();
    let system_instruction = system_instruction::transfer(
        &ctx.payer.pubkey(),
        &elgamal_registry_address,
        rent.minimum_balance(ELGAMAL_REGISTRY_ACCOUNT_LEN),
    );
    let create_registry_instructions =
        spl_elgamal_registry::instruction::create_registry(&alice.pubkey(), proof_location)
            .unwrap();

    let payer_pubkey = ctx.payer.pubkey();
    let instructions = [&[system_instruction], &create_registry_instructions[..]].concat();
    let tx = Transaction::new_signed_with_payer(
        &instructions,
        Some(&payer_pubkey),
        &[&ctx.payer, &alice],
        ctx.last_blockhash,
    );
    ctx.banks_client.process_transaction(tx).await.unwrap();
    drop(ctx);

    token
        .create_auxiliary_token_account_with_extension_space(
            &alice_account_keypair,
            &alice.pubkey(),
            vec![ExtensionType::CpiGuard],
        )
        .await
        .unwrap();

    token
        .enable_cpi_guard(&alice_token_account, &alice.pubkey(), &[&alice])
        .await
        .unwrap();

    // configure from the registry with cpi guard doesn't work, even outside cpi
    let error = token
        .confidential_transfer_configure_token_account_with_registry(
            &alice_token_account,
            &elgamal_registry_address,
            Some(&payer_pubkey),
        )
        .await
        .unwrap_err();
    assert_eq!(
        error,
        client_error(TokenError::CpiGuardConfigureAccountWithRegistryBlocked)
    );

    // configure from the registry works with cpi guard off
    token
        .disable_cpi_guard(&alice_token_account, &alice.pubkey(), &[&alice])
        .await
        .unwrap();

    token
        .confidential_transfer_configure_token_account_with_registry(
            &alice_token_account,
            &elgamal_registry_address,
            Some(&payer_pubkey),
        )
        .await
        .unwrap();

    let alice_state = token.get_account_info(&alice_token_account).await.unwrap();
    let extension = alice_state
        .get_extension::<ConfidentialTransferAccount>()
        .unwrap();
    assert_eq!(extension.elgamal_pubkey, (*elgamal_keypair.pubkey()).into());
}

#[tokio::test]
async fn test_cpi_guard_confidential_apply_pending_balance() {
    let context = make_context_with_confidential_mint().await;
    let TokenContext {
        token,
        mint_authority,
        alice,
        decimals,
        ..
    } = context.token_context.unwrap();

    let alice_meta = ConfidentialTokenAccountMeta::new(&token, &alice, None, false, false).await;
    let alice_account = alice_meta.token_account;

    token
        .reallocate(
            &alice_account,
            &alice.pubkey(),
            &[ExtensionType::CpiGuard],
            &[&alice],
        )
        .await
        .unwrap();

    token
        .mint_to(
            &alice_account,
            &mint_authority.pubkey(),
            100,
            &[&mint_authority],
        )
        .await
        .unwrap();

    let apply_pending_balance = [wrap_instruction(
        spl_instruction_padding_interface::id(),
        confidential_transfer::instruction::apply_pending_balance(
            &spl_token_2022_interface::id(),
            &alice_account,
            1,
            &alice_meta.aes_key.encrypt(2).into(),
            &alice.pubkey(),
            &[],
        )
        .unwrap(),
        vec![],
        0,
    )
    .unwrap()];

    let pending_balance_credit_counter = || async {
        let alice_state = token.get_account_info(&alice_account).await.unwrap();
        let extension = alice_state
            .get_extension::<ConfidentialTransferAccount>()
            .unwrap();
        u64::from(extension.pending_balance_credit_counter)
    };

    token
        .enable_cpi_guard(&alice_account, &alice.pubkey(), &[&alice])
        .await
        .unwrap();

    // apply pending balance works normally with cpi guard enabled
    token
        .confidential_transfer_deposit(&alice_account, &alice.pubkey(), 1, decimals, &[&alice])
        .await
        .unwrap();

    token
        .confidential_transfer_apply_pending_balance(
            &alice_account,
            &alice.pubkey(),
            None,
            alice_meta.elgamal_keypair.secret(),
            &alice_meta.aes_key,
            &[&alice],
        )
        .await
        .unwrap();
    assert_eq!(pending_balance_credit_counter().await, 0);

    // user-auth cpi apply pending balance with cpi guard doesn't work
    token
        .confidential_transfer_deposit(&alice_account, &alice.pubkey(), 1, decimals, &[&alice])
        .await
        .unwrap();

    let error = token
        .process_ixs(&apply_pending_balance, &[&alice])
        .await
        .unwrap_err();
    assert_eq!(
        error,
        client_error(TokenError::CpiGuardApplyPendingBalanceBlocked)
    );
    assert_eq!(pending_balance_credit_counter().await, 1);

    // apply pending balance still works through cpi with cpi guard off
    token
        .disable_cpi_guard(&alice_account, &alice.pubkey(), &[&alice])
        .await
        .unwrap();

    token
        .process_ixs(&apply_pending_balance, &[&alice])
        .await
        .unwrap();
    assert_eq!(pending_balance_credit_counter().await, 0);
}
