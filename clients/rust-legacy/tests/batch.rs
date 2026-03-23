mod program_test;

use {
    program_test::{keypair_clone, TestContext, TokenContext},
    solana_program_test::tokio,
    solana_sdk::{
        instruction::{Instruction, InstructionError},
        program_pack::Pack,
        pubkey::Pubkey,
        signature::Signer,
        signer::keypair::Keypair,
        transaction::{Transaction, TransactionError},
        transport::TransportError,
    },
    solana_system_interface::instruction as system_instruction,
    spl_token_2022_interface::{
        extension::ExtensionType,
        id,
        instruction::*,
        state::{Account, Mint},
    },
    spl_token_client::{
        client::ProgramBanksClientProcessTransaction,
        token::{Token, TokenError as TokenClientError, TokenResult},
    },
};

type TestToken = Token<ProgramBanksClientProcessTransaction>;

fn wrap_in_batch(ix: &Instruction) -> Instruction {
    let mut data = vec![0xff, ix.accounts.len() as u8, ix.data.len() as u8];
    data.extend_from_slice(&ix.data);
    Instruction {
        program_id: id(),
        data,
        accounts: ix.accounts.clone(),
    }
}

async fn process_batch_ix(
    token: &TestToken,
    ix: Instruction,
    signers: &[&dyn Signer],
) -> TokenResult<()> {
    let batch_ix = wrap_in_batch(&ix);
    let signers_vec = signers.to_vec();
    token.process_ixs(&[batch_ix], &signers_vec).await
}

async fn create_raw_account(
    token: &TestToken,
    payer: &Pubkey,
    account: &Keypair,
    owner: &Pubkey,
    space: usize,
    lamports: u64,
) {
    token
        .process_ixs(
            &[system_instruction::create_account(
                payer,
                &account.pubkey(),
                lamports,
                space as u64,
                owner,
            )],
            &[account],
        )
        .await
        .unwrap();
}

async fn transfer_lamports(context: &TestContext, destination: &Pubkey, amount: u64) {
    let ctx = context.context.lock().await;
    let payer = keypair_clone(&ctx.payer);
    let tx = Transaction::new_signed_with_payer(
        &[system_instruction::transfer(
            &payer.pubkey(),
            destination,
            amount,
        )],
        Some(&payer.pubkey()),
        &[&payer],
        ctx.last_blockhash,
    );
    ctx.banks_client.process_transaction(tx).await.unwrap();
}

async fn set_account_owner(context: &TestContext, address: &Pubkey, owner: Pubkey) {
    let mut ctx = context.context.lock().await;
    let mut account = ctx
        .banks_client
        .get_account(*address)
        .await
        .unwrap()
        .unwrap();
    account.owner = owner;
    ctx.set_account(address, &account.into());

    ctx.warp_forward_force_reward_interval_end().unwrap();
}

#[tokio::test]
async fn batch_mint_and_burn_owner_checks() {
    let mut context = TestContext::new().await;
    context.init_token_with_mint(vec![]).await.unwrap();

    let TokenContext {
        token,
        mint_authority,
        alice,
        decimals,
        ..
    } = context.token_context.take().unwrap();

    let alice_account = Keypair::new();
    token
        .create_auxiliary_token_account(&alice_account, &alice.pubkey())
        .await
        .unwrap();
    let alice_account = alice_account.pubkey();

    token
        .mint_to(
            &alice_account,
            &mint_authority.pubkey(),
            1_000,
            &[&mint_authority],
        )
        .await
        .unwrap();

    let alice_account_2 = Keypair::new();
    token
        .create_auxiliary_token_account(&alice_account_2, &alice.pubkey())
        .await
        .unwrap();
    let alice_account_2 = alice_account_2.pubkey();

    let alice_account_invalid = Keypair::new();
    token
        .create_auxiliary_token_account(&alice_account_invalid, &alice.pubkey())
        .await
        .unwrap();
    let alice_account_invalid = alice_account_invalid.pubkey();

    let alice_account_2_invalid = Keypair::new();
    token
        .create_auxiliary_token_account(&alice_account_2_invalid, &alice.pubkey())
        .await
        .unwrap();
    let alice_account_2_invalid = alice_account_2_invalid.pubkey();
    token
        .mint_to(
            &alice_account_2_invalid,
            &mint_authority.pubkey(),
            1,
            &[&mint_authority],
        )
        .await
        .unwrap();

    let invalid_owner = Pubkey::new_unique();

    set_account_owner(&context, &alice_account_invalid, invalid_owner).await;

    set_account_owner(&context, &alice_account_2_invalid, invalid_owner).await;

    set_account_owner(&context, token.get_address(), invalid_owner).await;

    assert_eq!(
        process_batch_ix(
            &token,
            mint_to(
                &id(),
                token.get_address(),
                &alice_account,
                &mint_authority.pubkey(),
                &[],
                1,
            )
            .unwrap(),
            &[&mint_authority],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );
    set_account_owner(&context, token.get_address(), id()).await;

    assert_eq!(
        process_batch_ix(
            &token,
            mint_to(
                &id(),
                token.get_address(),
                &alice_account_invalid,
                &mint_authority.pubkey(),
                &[],
                1,
            )
            .unwrap(),
            &[&mint_authority],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    process_batch_ix(
        &token,
        mint_to(
            &id(),
            token.get_address(),
            &alice_account,
            &mint_authority.pubkey(),
            &[],
            1,
        )
        .unwrap(),
        &[&mint_authority],
    )
    .await
    .unwrap();

    token
        .mint_to(
            &alice_account_2,
            &mint_authority.pubkey(),
            1,
            &[&mint_authority],
        )
        .await
        .unwrap();

    set_account_owner(&context, token.get_address(), invalid_owner).await;

    assert_eq!(
        process_batch_ix(
            &token,
            mint_to_checked(
                &id(),
                token.get_address(),
                &alice_account_2,
                &mint_authority.pubkey(),
                &[],
                1,
                decimals,
            )
            .unwrap(),
            &[&mint_authority],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );
    set_account_owner(&context, token.get_address(), id()).await;

    assert_eq!(
        process_batch_ix(
            &token,
            mint_to_checked(
                &id(),
                token.get_address(),
                &alice_account_invalid,
                &mint_authority.pubkey(),
                &[],
                1,
                decimals,
            )
            .unwrap(),
            &[&mint_authority],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );
    set_account_owner(&context, token.get_address(), id()).await;

    process_batch_ix(
        &token,
        mint_to_checked(
            &id(),
            token.get_address(),
            &alice_account_2,
            &mint_authority.pubkey(),
            &[],
            1,
            decimals,
        )
        .unwrap(),
        &[&mint_authority],
    )
    .await
    .unwrap();

    assert_eq!(
        process_batch_ix(
            &token,
            burn(
                &id(),
                &alice_account_2_invalid,
                token.get_address(),
                &alice.pubkey(),
                &[],
                1,
            )
            .unwrap(),
            &[&alice],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    process_batch_ix(
        &token,
        burn(
            &id(),
            &alice_account,
            token.get_address(),
            &alice.pubkey(),
            &[],
            1,
        )
        .unwrap(),
        &[&alice],
    )
    .await
    .unwrap();

    set_account_owner(&context, token.get_address(), invalid_owner).await;

    assert_eq!(
        process_batch_ix(
            &token,
            burn(
                &id(),
                &alice_account,
                token.get_address(),
                &alice.pubkey(),
                &[],
                1,
            )
            .unwrap(),
            &[&alice],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );
    set_account_owner(&context, token.get_address(), id()).await;

    assert_eq!(
        process_batch_ix(
            &token,
            burn_checked(
                &id(),
                &alice_account_2_invalid,
                token.get_address(),
                &alice.pubkey(),
                &[],
                1,
                decimals,
            )
            .unwrap(),
            &[&alice],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    set_account_owner(&context, token.get_address(), invalid_owner).await;

    assert_eq!(
        process_batch_ix(
            &token,
            burn_checked(
                &id(),
                &alice_account_2,
                token.get_address(),
                &alice.pubkey(),
                &[],
                1,
                decimals,
            )
            .unwrap(),
            &[&alice],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    set_account_owner(&context, token.get_address(), id()).await;

    process_batch_ix(
        &token,
        burn_checked(
            &id(),
            &alice_account_2,
            token.get_address(),
            &alice.pubkey(),
            &[],
            1,
            decimals,
        )
        .unwrap(),
        &[&alice],
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn batch_set_authority_freeze_thaw_close_owner_checks() {
    let mut context = TestContext::new().await;
    context.init_token_with_freezing_mint(vec![]).await.unwrap();

    let TokenContext {
        token,
        alice,
        freeze_authority,
        ..
    } = context.token_context.take().unwrap();
    let freeze_authority = freeze_authority.unwrap();

    let token_account = Keypair::new();
    token
        .create_auxiliary_token_account(&token_account, &alice.pubkey())
        .await
        .unwrap();
    let token_account = token_account.pubkey();

    let token_account_invalid = Keypair::new();
    token
        .create_auxiliary_token_account(&token_account_invalid, &alice.pubkey())
        .await
        .unwrap();
    let token_account_invalid = token_account_invalid.pubkey();

    let close_target_account = Keypair::new();
    token
        .create_auxiliary_token_account(&close_target_account, &alice.pubkey())
        .await
        .unwrap();
    let close_target_account = close_target_account.pubkey();

    let close_target_account_invalid = Keypair::new();
    token
        .create_auxiliary_token_account(&close_target_account_invalid, &alice.pubkey())
        .await
        .unwrap();
    let close_target_account_invalid = close_target_account_invalid.pubkey();

    let invalid_owner = Pubkey::new_unique();

    set_account_owner(&context, &token_account_invalid, invalid_owner).await;

    set_account_owner(&context, &close_target_account_invalid, invalid_owner).await;

    assert_eq!(
        process_batch_ix(
            &token,
            set_authority(
                &id(),
                &token_account_invalid,
                Some(&Pubkey::new_unique()),
                AuthorityType::CloseAccount,
                &alice.pubkey(),
                &[],
            )
            .unwrap(),
            &[&alice],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    set_account_owner(&context, token.get_address(), invalid_owner).await;

    assert_eq!(
        process_batch_ix(
            &token,
            set_authority(
                &id(),
                token.get_address(),
                Some(&Pubkey::new_unique()),
                AuthorityType::FreezeAccount,
                &freeze_authority.pubkey(),
                &[],
            )
            .unwrap(),
            &[&freeze_authority],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );
    set_account_owner(&context, token.get_address(), id()).await;

    process_batch_ix(
        &token,
        set_authority(
            &id(),
            &token_account,
            Some(&Pubkey::new_unique()),
            AuthorityType::CloseAccount,
            &alice.pubkey(),
            &[],
        )
        .unwrap(),
        &[&alice],
    )
    .await
    .unwrap();

    process_batch_ix(
        &token,
        set_authority(
            &id(),
            token.get_address(),
            Some(&freeze_authority.pubkey()),
            AuthorityType::FreezeAccount,
            &freeze_authority.pubkey(),
            &[],
        )
        .unwrap(),
        &[&freeze_authority],
    )
    .await
    .unwrap();

    assert_eq!(
        process_batch_ix(
            &token,
            freeze_account(
                &id(),
                &token_account_invalid,
                token.get_address(),
                &freeze_authority.pubkey(),
                &[],
            )
            .unwrap(),
            &[&freeze_authority],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );
    set_account_owner(&context, token.get_address(), invalid_owner).await;

    assert_eq!(
        process_batch_ix(
            &token,
            freeze_account(
                &id(),
                &token_account,
                token.get_address(),
                &freeze_authority.pubkey(),
                &[],
            )
            .unwrap(),
            &[&freeze_authority],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );
    set_account_owner(&context, token.get_address(), id()).await;

    process_batch_ix(
        &token,
        freeze_account(
            &id(),
            &token_account,
            token.get_address(),
            &freeze_authority.pubkey(),
            &[],
        )
        .unwrap(),
        &[&freeze_authority],
    )
    .await
    .unwrap();

    assert_eq!(
        process_batch_ix(
            &token,
            thaw_account(
                &id(),
                &token_account_invalid,
                token.get_address(),
                &freeze_authority.pubkey(),
                &[],
            )
            .unwrap(),
            &[&freeze_authority],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    set_account_owner(&context, token.get_address(), invalid_owner).await;

    assert_eq!(
        process_batch_ix(
            &token,
            thaw_account(
                &id(),
                &token_account,
                token.get_address(),
                &freeze_authority.pubkey(),
                &[],
            )
            .unwrap(),
            &[&freeze_authority],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );
    set_account_owner(&context, token.get_address(), id()).await;

    process_batch_ix(
        &token,
        thaw_account(
            &id(),
            &token_account,
            token.get_address(),
            &freeze_authority.pubkey(),
            &[],
        )
        .unwrap(),
        &[&freeze_authority],
    )
    .await
    .unwrap();

    assert_eq!(
        process_batch_ix(
            &token,
            close_account(
                &id(),
                &close_target_account_invalid,
                &alice.pubkey(),
                &alice.pubkey(),
                &[],
            )
            .unwrap(),
            &[&alice],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );
    process_batch_ix(
        &token,
        close_account(
            &id(),
            &close_target_account,
            &alice.pubkey(),
            &alice.pubkey(),
            &[],
        )
        .unwrap(),
        &[&alice],
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn batch_sync_native_and_unwrap_lamports_owner_checks() {
    let mut context = TestContext::new().await;
    context.init_token_with_native_mint().await.unwrap();

    let TokenContext { token, alice, .. } = context.token_context.take().unwrap();

    let wrapped_account = Keypair::new();
    token
        .create_auxiliary_token_account(&wrapped_account, &alice.pubkey())
        .await
        .unwrap();
    let wrapped_account = wrapped_account.pubkey();

    let wrapped_account_invalid = Keypair::new();
    token
        .create_auxiliary_token_account(&wrapped_account_invalid, &alice.pubkey())
        .await
        .unwrap();
    let wrapped_account_invalid = wrapped_account_invalid.pubkey();

    transfer_lamports(&context, &wrapped_account, 1_000_000).await;
    transfer_lamports(&context, &wrapped_account_invalid, 1_000_000).await;
    transfer_lamports(&context, &alice.pubkey(), 1_000_000).await;

    let invalid_owner = Pubkey::new_unique();
    set_account_owner(&context, &wrapped_account_invalid, invalid_owner).await;

    assert_eq!(
        process_batch_ix(
            &token,
            sync_native(&id(), &wrapped_account_invalid).unwrap(),
            &[] as &[&dyn Signer],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );
    process_batch_ix(
        &token,
        sync_native(&id(), &wrapped_account).unwrap(),
        &[] as &[&dyn Signer],
    )
    .await
    .unwrap();

    assert_eq!(
        process_batch_ix(
            &token,
            unwrap_lamports(
                &id(),
                &wrapped_account_invalid,
                &alice.pubkey(),
                &alice.pubkey(),
                &[],
                Some(1),
            )
            .unwrap(),
            &[&alice],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    process_batch_ix(
        &token,
        unwrap_lamports(
            &id(),
            &wrapped_account,
            &alice.pubkey(),
            &alice.pubkey(),
            &[],
            Some(1),
        )
        .unwrap(),
        &[&alice],
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn batch_amount_conversion_get_size_init_close_withdraw_owner_checks() {
    let mut context = TestContext::new().await;
    context.init_token_with_mint(vec![]).await.unwrap();
    let payer = context.context.lock().await.payer.pubkey();

    let TokenContext {
        token,
        alice,
        mint_authority,
        decimals,
        ..
    } = context.token_context.take().unwrap();

    let invalid_owner = Pubkey::new_unique();

    let mint_account: &Pubkey = token.get_address();

    let mint_account_invalid = Keypair::new();
    create_raw_account(
        &token,
        &payer,
        &mint_account_invalid,
        &id(),
        Mint::LEN,
        1_000_000_000,
    )
    .await;
    let mint_account_invalid = mint_account_invalid.pubkey();

    process_batch_ix(
        &token,
        initialize_mint2(
            &id(),
            &mint_account_invalid,
            &mint_authority.pubkey(),
            None,
            decimals,
        )
        .unwrap(),
        &[] as &[&dyn Signer],
    )
    .await
    .unwrap();

    let mint_account_2 = Keypair::new();
    create_raw_account(
        &token,
        &payer,
        &mint_account_2,
        &id(),
        ExtensionType::try_calculate_account_len::<Mint>(&[ExtensionType::MintCloseAuthority])
            .unwrap(),
        1_000_000_000,
    )
    .await;

    let mint_account_2_invalid = Keypair::new();
    create_raw_account(
        &token,
        &payer,
        &mint_account_2_invalid,
        &id(),
        ExtensionType::try_calculate_account_len::<Mint>(&[ExtensionType::MintCloseAuthority])
            .unwrap(),
        1_000_000_000,
    )
    .await;

    let source_account = Keypair::new();
    token
        .create_auxiliary_token_account(&source_account, &alice.pubkey())
        .await
        .unwrap();
    let source_account = source_account.pubkey();
    transfer_lamports(&context, &source_account, 1_000_000).await;

    let source_account_invalid = Keypair::new();
    token
        .create_auxiliary_token_account(&source_account_invalid, &alice.pubkey())
        .await
        .unwrap();
    let source_account_invalid = source_account_invalid.pubkey();
    transfer_lamports(&context, &source_account_invalid, 1_000_000).await;

    set_account_owner(&context, &mint_account_invalid, invalid_owner).await;

    set_account_owner(&context, &mint_account_2_invalid.pubkey(), invalid_owner).await;

    set_account_owner(&context, &source_account_invalid, invalid_owner).await;

    assert_eq!(
        process_batch_ix(
            &token,
            amount_to_ui_amount(&id(), &mint_account_invalid, 23).unwrap(),
            &[] as &[&dyn Signer],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    process_batch_ix(
        &token,
        amount_to_ui_amount(&id(), mint_account, 23).unwrap(),
        &[] as &[&dyn Signer],
    )
    .await
    .unwrap();

    assert_eq!(
        process_batch_ix(
            &token,
            ui_amount_to_amount(&id(), &mint_account_invalid, "1.1").unwrap(),
            &[] as &[&dyn Signer],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    process_batch_ix(
        &token,
        ui_amount_to_amount(&id(), mint_account, "1.1").unwrap(),
        &[] as &[&dyn Signer],
    )
    .await
    .unwrap();

    assert_eq!(
        process_batch_ix(
            &token,
            get_account_data_size(&id(), &mint_account_invalid, &[]).unwrap(),
            &[] as &[&dyn Signer],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    process_batch_ix(
        &token,
        get_account_data_size(&id(), mint_account, &[]).unwrap(),
        &[] as &[&dyn Signer],
    )
    .await
    .unwrap();

    assert_eq!(
        process_batch_ix(
            &token,
            initialize_mint_close_authority(
                &id(),
                &mint_account_2_invalid.pubkey(),
                Some(&alice.pubkey()),
            )
            .unwrap(),
            &[] as &[&dyn Signer],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    process_batch_ix(
        &token,
        initialize_mint_close_authority(&id(), &mint_account_2.pubkey(), Some(&alice.pubkey()))
            .unwrap(),
        &[] as &[&dyn Signer],
    )
    .await
    .unwrap();

    assert_eq!(
        process_batch_ix(
            &token,
            withdraw_excess_lamports(
                &id(),
                &source_account_invalid,
                &alice.pubkey(),
                &alice.pubkey(),
                &[],
            )
            .unwrap(),
            &[&alice],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    process_batch_ix(
        &token,
        withdraw_excess_lamports(
            &id(),
            &source_account,
            &alice.pubkey(),
            &alice.pubkey(),
            &[],
        )
        .unwrap(),
        &[&alice],
    )
    .await
    .unwrap();
}

#[tokio::test]
#[allow(deprecated)]
async fn batch_transfer_variants_owner_checks() {
    let mut context = TestContext::new().await;
    context.init_token_with_mint(vec![]).await.unwrap();
    let TokenContext {
        token,
        mint_authority,
        alice,
        decimals,
        ..
    } = context.token_context.take().unwrap();

    let source_account = Keypair::new();
    token
        .create_auxiliary_token_account(&source_account, &alice.pubkey())
        .await
        .unwrap();
    let source_account = source_account.pubkey();

    let destination_account = Keypair::new();
    token
        .create_auxiliary_token_account(&destination_account, &alice.pubkey())
        .await
        .unwrap();
    let destination_account = destination_account.pubkey();

    let source_account_invalid = Keypair::new();
    token
        .create_auxiliary_token_account(&source_account_invalid, &alice.pubkey())
        .await
        .unwrap();
    let source_account_invalid = source_account_invalid.pubkey();

    let destination_account_invalid = Keypair::new();
    token
        .create_auxiliary_token_account(&destination_account_invalid, &alice.pubkey())
        .await
        .unwrap();
    let destination_account_invalid = destination_account_invalid.pubkey();

    token
        .mint_to(
            &source_account,
            &mint_authority.pubkey(),
            100,
            &[&mint_authority],
        )
        .await
        .unwrap();

    token
        .mint_to(
            &source_account_invalid,
            &mint_authority.pubkey(),
            100,
            &[&mint_authority],
        )
        .await
        .unwrap();

    let invalid_owner = Pubkey::new_unique();

    set_account_owner(&context, &source_account_invalid, invalid_owner).await;

    set_account_owner(&context, &destination_account_invalid, invalid_owner).await;

    assert_eq!(
        process_batch_ix(
            &token,
            transfer(
                &id(),
                &source_account_invalid,
                &destination_account,
                &alice.pubkey(),
                &[],
                1,
            )
            .unwrap(),
            &[&alice],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    assert_eq!(
        process_batch_ix(
            &token,
            transfer(
                &id(),
                &source_account,
                &destination_account_invalid,
                &alice.pubkey(),
                &[],
                1,
            )
            .unwrap(),
            &[&alice],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    process_batch_ix(
        &token,
        transfer(
            &id(),
            &source_account,
            &destination_account,
            &alice.pubkey(),
            &[],
            1,
        )
        .unwrap(),
        &[&alice],
    )
    .await
    .unwrap();

    assert_eq!(
        process_batch_ix(
            &token,
            transfer_checked(
                &id(),
                &source_account_invalid,
                token.get_address(),
                &destination_account,
                &alice.pubkey(),
                &[],
                1,
                decimals,
            )
            .unwrap(),
            &[&alice],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    assert_eq!(
        process_batch_ix(
            &token,
            transfer_checked(
                &id(),
                &source_account,
                token.get_address(),
                &destination_account_invalid,
                &alice.pubkey(),
                &[],
                1,
                decimals,
            )
            .unwrap(),
            &[&alice],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    process_batch_ix(
        &token,
        transfer_checked(
            &id(),
            &source_account,
            token.get_address(),
            &destination_account,
            &alice.pubkey(),
            &[],
            1,
            decimals,
        )
        .unwrap(),
        &[&alice],
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn batch_initialize_account_variants_owner_checks() {
    let mut context = TestContext::new().await;
    context.init_token_with_mint(vec![]).await.unwrap();
    let payer = context.context.lock().await.payer.pubkey();

    let TokenContext { token, alice, .. } = context.token_context.take().unwrap();

    let invalid_owner = Pubkey::new_unique();

    let token_account_1 = Keypair::new();
    create_raw_account(
        &token,
        &payer,
        &token_account_1,
        &id(),
        Account::LEN,
        1_000_000_000,
    )
    .await;

    let token_account_1_invalid = Keypair::new();
    create_raw_account(
        &token,
        &payer,
        &token_account_1_invalid,
        &id(),
        Account::LEN,
        1_000_000_000,
    )
    .await;

    let token_account_2 = Keypair::new();
    create_raw_account(
        &token,
        &payer,
        &token_account_2,
        &id(),
        Account::LEN,
        1_000_000_000,
    )
    .await;

    let token_account_2_invalid = Keypair::new();
    create_raw_account(
        &token,
        &payer,
        &token_account_2_invalid,
        &id(),
        Account::LEN,
        1_000_000_000,
    )
    .await;

    let token_account_3 = Keypair::new();
    create_raw_account(
        &token,
        &payer,
        &token_account_3,
        &id(),
        Account::LEN,
        1_000_000_000,
    )
    .await;

    let token_account_3_invalid = Keypair::new();
    create_raw_account(
        &token,
        &payer,
        &token_account_3_invalid,
        &id(),
        Account::LEN,
        1_000_000_000,
    )
    .await;

    set_account_owner(&context, &token_account_1_invalid.pubkey(), invalid_owner).await;

    set_account_owner(&context, &token_account_2_invalid.pubkey(), invalid_owner).await;

    set_account_owner(&context, &token_account_3_invalid.pubkey(), invalid_owner).await;

    assert_eq!(
        process_batch_ix(
            &token,
            initialize_account(
                &id(),
                &token_account_1_invalid.pubkey(),
                token.get_address(),
                &alice.pubkey(),
            )
            .unwrap(),
            &[] as &[&dyn Signer],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    set_account_owner(&context, token.get_address(), invalid_owner).await;

    assert_eq!(
        process_batch_ix(
            &token,
            initialize_account(
                &id(),
                &token_account_1.pubkey(),
                token.get_address(),
                &alice.pubkey(),
            )
            .unwrap(),
            &[] as &[&dyn Signer],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    set_account_owner(&context, token.get_address(), id()).await;

    process_batch_ix(
        &token,
        initialize_account(
            &id(),
            &token_account_1.pubkey(),
            token.get_address(),
            &alice.pubkey(),
        )
        .unwrap(),
        &[] as &[&dyn Signer],
    )
    .await
    .unwrap();

    assert_eq!(
        process_batch_ix(
            &token,
            initialize_account2(
                &id(),
                &token_account_2_invalid.pubkey(),
                token.get_address(),
                &alice.pubkey(),
            )
            .unwrap(),
            &[] as &[&dyn Signer],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    set_account_owner(&context, token.get_address(), invalid_owner).await;

    assert_eq!(
        process_batch_ix(
            &token,
            initialize_account2(
                &id(),
                &token_account_2.pubkey(),
                token.get_address(),
                &alice.pubkey(),
            )
            .unwrap(),
            &[] as &[&dyn Signer],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    set_account_owner(&context, token.get_address(), id()).await;

    process_batch_ix(
        &token,
        initialize_account2(
            &id(),
            &token_account_2.pubkey(),
            token.get_address(),
            &alice.pubkey(),
        )
        .unwrap(),
        &[] as &[&dyn Signer],
    )
    .await
    .unwrap();

    assert_eq!(
        process_batch_ix(
            &token,
            initialize_account3(
                &id(),
                &token_account_3_invalid.pubkey(),
                token.get_address(),
                &alice.pubkey(),
            )
            .unwrap(),
            &[] as &[&dyn Signer],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    set_account_owner(&context, token.get_address(), invalid_owner).await;

    assert_eq!(
        process_batch_ix(
            &token,
            initialize_account3(
                &id(),
                &token_account_3.pubkey(),
                token.get_address(),
                &alice.pubkey(),
            )
            .unwrap(),
            &[] as &[&dyn Signer],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    set_account_owner(&context, token.get_address(), id()).await;

    process_batch_ix(
        &token,
        initialize_account3(
            &id(),
            &token_account_3.pubkey(),
            token.get_address(),
            &alice.pubkey(),
        )
        .unwrap(),
        &[] as &[&dyn Signer],
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn batch_initialize_mint_variants_owner_checks() {
    let mut context = TestContext::new().await;
    context.init_token_with_mint(vec![]).await.unwrap();
    let payer = context.context.lock().await.payer.pubkey();

    let TokenContext {
        token,
        mint_authority,
        freeze_authority,
        decimals,
        ..
    } = context.token_context.take().unwrap();
    let freeze_authority_pubkey = freeze_authority
        .as_ref()
        .map(|authority| authority.pubkey());

    let invalid_owner = Pubkey::new_unique();

    let mint_account_1 = Keypair::new();
    create_raw_account(
        &token,
        &payer,
        &mint_account_1,
        &id(),
        Mint::LEN,
        1_000_000_000,
    )
    .await;

    let mint_account_1_invalid = Keypair::new();
    create_raw_account(
        &token,
        &payer,
        &mint_account_1_invalid,
        &id(),
        Mint::LEN,
        1_000_000_000,
    )
    .await;

    let mint_account_2 = Keypair::new();
    create_raw_account(
        &token,
        &payer,
        &mint_account_2,
        &id(),
        Mint::LEN,
        1_000_000_000,
    )
    .await;

    let mint_account_2_invalid = Keypair::new();
    create_raw_account(
        &token,
        &payer,
        &mint_account_2_invalid,
        &id(),
        Mint::LEN,
        1_000_000_000,
    )
    .await;

    set_account_owner(&context, &mint_account_1_invalid.pubkey(), invalid_owner).await;

    set_account_owner(&context, &mint_account_2_invalid.pubkey(), invalid_owner).await;

    assert_eq!(
        process_batch_ix(
            &token,
            initialize_mint(
                &id(),
                &mint_account_1_invalid.pubkey(),
                &mint_authority.pubkey(),
                freeze_authority_pubkey.as_ref(),
                decimals,
            )
            .unwrap(),
            &[] as &[&dyn Signer],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    process_batch_ix(
        &token,
        initialize_mint(
            &id(),
            &mint_account_1.pubkey(),
            &mint_authority.pubkey(),
            freeze_authority_pubkey.as_ref(),
            decimals,
        )
        .unwrap(),
        &[] as &[&dyn Signer],
    )
    .await
    .unwrap();

    assert_eq!(
        process_batch_ix(
            &token,
            initialize_mint2(
                &id(),
                &mint_account_2_invalid.pubkey(),
                &mint_authority.pubkey(),
                freeze_authority_pubkey.as_ref(),
                decimals,
            )
            .unwrap(),
            &[] as &[&dyn Signer],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    process_batch_ix(
        &token,
        initialize_mint2(
            &id(),
            &mint_account_2.pubkey(),
            &mint_authority.pubkey(),
            freeze_authority_pubkey.as_ref(),
            decimals,
        )
        .unwrap(),
        &[] as &[&dyn Signer],
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn batch_reallocate_and_init_extension_owner_checks() {
    let mut context = TestContext::new().await;
    context.init_token_with_mint(vec![]).await.unwrap();
    let payer = context.context.lock().await.payer.pubkey();

    let TokenContext { token, alice, .. } = context.token_context.take().unwrap();

    let token_account = Keypair::new();
    token
        .create_auxiliary_token_account(&token_account, &alice.pubkey())
        .await
        .unwrap();
    let token_account = token_account.pubkey();

    let token_account_invalid = Keypair::new();
    token
        .create_auxiliary_token_account(&token_account_invalid, &alice.pubkey())
        .await
        .unwrap();
    let token_account_invalid = token_account_invalid.pubkey();

    let uninitialized_token_account = Keypair::new();
    create_raw_account(
        &token,
        &payer,
        &uninitialized_token_account,
        &id(),
        ExtensionType::try_calculate_account_len::<Account>(&[ExtensionType::ImmutableOwner])
            .unwrap(),
        1_000_000_000,
    )
    .await;

    let uninitialized_token_account_invalid = Keypair::new();
    create_raw_account(
        &token,
        &payer,
        &uninitialized_token_account_invalid,
        &id(),
        ExtensionType::try_calculate_account_len::<Account>(&[ExtensionType::ImmutableOwner])
            .unwrap(),
        1_000_000_000,
    )
    .await;
    let uninitialized_mint_account = Keypair::new();
    create_raw_account(
        &token,
        &payer,
        &uninitialized_mint_account,
        &id(),
        ExtensionType::try_calculate_account_len::<Mint>(&[
            ExtensionType::NonTransferable,
            ExtensionType::PermanentDelegate,
        ])
        .unwrap(),
        1_000_000_000,
    )
    .await;

    let non_transferable_mint_account_invalid = Keypair::new();
    create_raw_account(
        &token,
        &payer,
        &non_transferable_mint_account_invalid,
        &id(),
        ExtensionType::try_calculate_account_len::<Mint>(&[
            ExtensionType::NonTransferable,
            ExtensionType::PermanentDelegate,
        ])
        .unwrap(),
        1_000_000_000,
    )
    .await;

    let uninitialized_mint_account_invalid = Keypair::new();
    create_raw_account(
        &token,
        &payer,
        &uninitialized_mint_account_invalid,
        &id(),
        ExtensionType::try_calculate_account_len::<Mint>(&[
            ExtensionType::NonTransferable,
            ExtensionType::PermanentDelegate,
        ])
        .unwrap(),
        1_000_000_000,
    )
    .await;

    let invalid_owner = Pubkey::new_unique();
    set_account_owner(&context, &token_account_invalid, invalid_owner).await;

    set_account_owner(
        &context,
        &uninitialized_token_account_invalid.pubkey(),
        invalid_owner,
    )
    .await;

    set_account_owner(
        &context,
        &uninitialized_mint_account_invalid.pubkey(),
        invalid_owner,
    )
    .await;
    set_account_owner(
        &context,
        &non_transferable_mint_account_invalid.pubkey(),
        invalid_owner,
    )
    .await;

    assert_eq!(
        process_batch_ix(
            &token,
            reallocate(
                &id(),
                &token_account_invalid,
                &payer,
                &alice.pubkey(),
                &[],
                &[ExtensionType::CpiGuard],
            )
            .unwrap(),
            &[&alice],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    assert_eq!(
        process_batch_ix(
            &token,
            initialize_immutable_owner(&id(), &uninitialized_token_account_invalid.pubkey())
                .unwrap(),
            &[] as &[&dyn Signer],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    process_batch_ix(
        &token,
        reallocate(&id(), &token_account, &payer, &alice.pubkey(), &[], &[]).unwrap(),
        &[&alice],
    )
    .await
    .unwrap();

    process_batch_ix(
        &token,
        initialize_immutable_owner(&id(), &uninitialized_token_account.pubkey()).unwrap(),
        &[] as &[&dyn Signer],
    )
    .await
    .unwrap();

    assert_eq!(
        process_batch_ix(
            &token,
            initialize_non_transferable_mint(
                &id(),
                &non_transferable_mint_account_invalid.pubkey(),
            )
            .unwrap(),
            &[] as &[&dyn Signer],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    process_batch_ix(
        &token,
        initialize_non_transferable_mint(&id(), &uninitialized_mint_account.pubkey()).unwrap(),
        &[] as &[&dyn Signer],
    )
    .await
    .unwrap();

    assert_eq!(
        process_batch_ix(
            &token,
            initialize_permanent_delegate(
                &id(),
                &uninitialized_mint_account_invalid.pubkey(),
                &alice.pubkey(),
            )
            .unwrap(),
            &[] as &[&dyn Signer],
        )
        .await
        .unwrap_err(),
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        )))
    );

    process_batch_ix(
        &token,
        initialize_permanent_delegate(&id(), &uninitialized_mint_account.pubkey(), &alice.pubkey())
            .unwrap(),
        &[] as &[&dyn Signer],
    )
    .await
    .unwrap();
}
