#![allow(clippy::arithmetic_side_effects)]
mod program_test;
use {
    program_test::{TestContext, TokenContext},
    solana_program_pack::Pack,
    solana_program_test::tokio,
    solana_sdk::{
        instruction::InstructionError, rent::Rent, signature::Signer, signer::keypair::Keypair,
        transaction::TransactionError, transport::TransportError,
    },
    spl_token_2022::extension::ExtensionType,
    spl_token_2022_interface::{error::TokenError, state::Account},
    spl_token_client::token::TokenError as TokenClientError,
};

#[derive(PartialEq)]
enum TestMode {
    Regular,
    WithImmutableOwner,
}

async fn run_basic_unwrap_lamports(context: TestContext, test_mode: TestMode) {
    let TokenContext {
        token, alice, bob, ..
    } = context.token_context.unwrap();

    let amount = 10000000000;
    let account_space = match test_mode {
        TestMode::Regular => Account::get_packed_len(),
        TestMode::WithImmutableOwner => {
            ExtensionType::try_calculate_account_len::<Account>(&[ExtensionType::ImmutableOwner])
                .unwrap()
        }
    };

    let rent_exempt_lamports = Rent::default().minimum_balance(account_space);

    let alice_account = Keypair::new();
    match test_mode {
        TestMode::WithImmutableOwner => {
            token
                .wrap(
                    &alice_account.pubkey(),
                    &alice.pubkey(),
                    amount,
                    &[&alice_account],
                )
                .await
                .unwrap();
        }
        TestMode::Regular => {
            token
                .wrap_with_mutable_ownership(
                    &alice_account.pubkey(),
                    &alice.pubkey(),
                    amount,
                    &[&alice_account],
                )
                .await
                .unwrap();
        }
    }
    let alice_account = alice_account.pubkey();
    let bob_account = Keypair::new();
    match test_mode {
        TestMode::WithImmutableOwner => {
            token
                .wrap(
                    &bob_account.pubkey(),
                    &bob.pubkey(),
                    amount,
                    &[&bob_account],
                )
                .await
                .unwrap();
        }
        TestMode::Regular => {
            token
                .wrap_with_mutable_ownership(
                    &bob_account.pubkey(),
                    &bob.pubkey(),
                    amount,
                    &[&bob_account],
                )
                .await
                .unwrap();
        }
    }
    let bob_account = bob_account.pubkey();

    // unwrap Some(1) lamports is ok
    token
        .unwrap_lamports(
            &alice_account,
            &bob_account,
            &alice.pubkey(),
            Some(1),
            &[&alice],
        )
        .await
        .unwrap();

    let alice_account_account = token.get_account(alice_account).await.unwrap();
    let alice_account_token_account = token.get_account_info(&alice_account).await.unwrap();
    assert_eq!(alice_account_account.lamports, amount - 1);
    assert_eq!(
        alice_account_token_account.base.amount,
        amount - (rent_exempt_lamports + 1)
    );

    let bob_account_account = token.get_account(bob_account).await.unwrap();
    assert_eq!(bob_account_account.lamports, amount + 1);

    // unwrap too much lamports is not ok
    let error = token
        .unwrap_lamports(
            &alice_account,
            &bob_account,
            &alice.pubkey(),
            Some(amount),
            &[&alice],
        )
        .await
        .unwrap_err();
    assert_eq!(
        error,
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(
                0,
                InstructionError::Custom(TokenError::InsufficientFunds as u32)
            )
        )))
    );

    // wrong signer
    let error = token
        .unwrap_lamports(
            &alice_account,
            &bob_account,
            &bob.pubkey(),
            Some(1),
            &[&bob],
        )
        .await
        .unwrap_err();
    assert_eq!(
        error,
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(
                0,
                InstructionError::Custom(TokenError::OwnerMismatch as u32)
            )
        )))
    );

    // unwrap None lamports is ok
    token
        .unwrap_lamports(
            &alice_account,
            &bob_account,
            &alice.pubkey(),
            None,
            &[&alice],
        )
        .await
        .unwrap();

    let alice_account_account = token.get_account(alice_account).await.unwrap();
    let alice_account_token_account = token.get_account_info(&alice_account).await.unwrap();
    assert_eq!(alice_account_account.lamports, rent_exempt_lamports);
    assert_eq!(alice_account_token_account.base.amount, 0);

    let bob_account_account = token.get_account(bob_account).await.unwrap();
    assert_eq!(
        bob_account_account.lamports,
        amount + (amount - rent_exempt_lamports)
    );
}

#[tokio::test]
async fn basic() {
    let mut context = TestContext::new().await;
    context.init_token_with_native_mint().await.unwrap();
    run_basic_unwrap_lamports(context, TestMode::Regular).await;
}

#[tokio::test]
async fn basic_with_extensions() {
    let mut context = TestContext::new().await;
    context.init_token_with_native_mint().await.unwrap();
    run_basic_unwrap_lamports(context, TestMode::WithImmutableOwner).await;
}

async fn run_self_unwrap_lamports(context: TestContext, test_mode: TestMode) {
    let TokenContext { token, alice, .. } = context.token_context.unwrap();

    let amount = 10000000000;
    let account_space;

    let alice_account = Keypair::new();
    match test_mode {
        TestMode::WithImmutableOwner => {
            account_space = ExtensionType::try_calculate_account_len::<Account>(&[
                ExtensionType::ImmutableOwner,
            ])
            .unwrap();

            token
                .wrap(
                    &alice_account.pubkey(),
                    &alice.pubkey(),
                    amount,
                    &[&alice_account],
                )
                .await
                .unwrap();
        }
        TestMode::Regular => {
            account_space = Account::get_packed_len();

            token
                .wrap_with_mutable_ownership(
                    &alice_account.pubkey(),
                    &alice.pubkey(),
                    amount,
                    &[&alice_account],
                )
                .await
                .unwrap();
        }
    }
    let rent_exempt_lamports = Rent::default().minimum_balance(account_space);

    let alice_account = alice_account.pubkey();

    // unwrap Some(1) lamports is ok
    token
        .unwrap_lamports(
            &alice_account,
            &alice_account,
            &alice.pubkey(),
            Some(1),
            &[&alice],
        )
        .await
        .unwrap();

    let alice_account_account = token.get_account(alice_account).await.unwrap();
    let alice_account_token_account = token.get_account_info(&alice_account).await.unwrap();
    assert_eq!(alice_account_account.lamports, amount);
    assert_eq!(
        alice_account_token_account.base.amount,
        (amount - 1) - rent_exempt_lamports,
    );

    // unwrap too much lamports is not ok
    let error = token
        .unwrap_lamports(
            &alice_account,
            &alice_account,
            &alice.pubkey(),
            Some(amount),
            &[&alice],
        )
        .await
        .unwrap_err();
    assert_eq!(
        error,
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(
                0,
                InstructionError::Custom(TokenError::InsufficientFunds as u32)
            )
        )))
    );

    // unwrap None lamports is ok
    token
        .unwrap_lamports(
            &alice_account,
            &alice_account,
            &alice.pubkey(),
            None,
            &[&alice],
        )
        .await
        .unwrap();

    let alice_account_account = token.get_account(alice_account).await.unwrap();
    let alice_account_token_account = token.get_account_info(&alice_account).await.unwrap();
    assert_eq!(alice_account_account.lamports, amount);
    assert_eq!(alice_account_token_account.base.amount, 0);
}

#[tokio::test]
async fn self_unwrap_lamports() {
    let mut context = TestContext::new().await;
    context.init_token_with_native_mint().await.unwrap();
    run_self_unwrap_lamports(context, TestMode::Regular).await;
}

#[tokio::test]
async fn self_unwrap_lamports_with_extension() {
    let mut context = TestContext::new().await;
    context.init_token_with_native_mint().await.unwrap();
    run_basic_unwrap_lamports(context, TestMode::WithImmutableOwner).await;
}

async fn run_self_owned_unwrap_lamports(context: TestContext, test_mode: TestMode) {
    let TokenContext {
        token, alice, bob, ..
    } = context.token_context.unwrap();

    let amount = 10000000000;
    let account_space = match test_mode {
        TestMode::Regular => Account::get_packed_len(),
        TestMode::WithImmutableOwner => {
            ExtensionType::try_calculate_account_len::<Account>(&[ExtensionType::ImmutableOwner])
                .unwrap()
        }
    };

    let rent_exempt_lamports = Rent::default().minimum_balance(account_space);

    match test_mode {
        TestMode::WithImmutableOwner => {
            token
                .wrap(&alice.pubkey(), &alice.pubkey(), amount, &[&alice])
                .await
                .unwrap();
        }
        TestMode::Regular => {
            token
                .wrap_with_mutable_ownership(&alice.pubkey(), &alice.pubkey(), amount, &[&alice])
                .await
                .unwrap();
        }
    }
    let alice_account = alice.pubkey();
    let bob_account = Keypair::new();
    match test_mode {
        TestMode::WithImmutableOwner => {
            token
                .wrap(
                    &bob_account.pubkey(),
                    &bob.pubkey(),
                    amount,
                    &[&bob_account],
                )
                .await
                .unwrap();
        }
        TestMode::Regular => {
            token
                .wrap_with_mutable_ownership(
                    &bob_account.pubkey(),
                    &bob.pubkey(),
                    amount,
                    &[&bob_account],
                )
                .await
                .unwrap();
        }
    }
    let bob_account = bob_account.pubkey();

    // unwrap Some(1) lamports is ok
    token
        .unwrap_lamports(
            &alice_account,
            &bob_account,
            &alice.pubkey(),
            Some(1),
            &[&alice],
        )
        .await
        .unwrap();

    let alice_account_account = token.get_account(alice_account).await.unwrap();
    let alice_account_token_account = token.get_account_info(&alice_account).await.unwrap();
    assert_eq!(alice_account_account.lamports, amount - 1);
    assert_eq!(
        alice_account_token_account.base.amount,
        amount - (rent_exempt_lamports + 1)
    );

    let bob_account_account = token.get_account(bob_account).await.unwrap();
    assert_eq!(bob_account_account.lamports, amount + 1);

    // self unwrap None lamports is ok
    token
        .unwrap_lamports(
            &alice_account,
            &bob_account,
            &alice.pubkey(),
            None,
            &[&alice],
        )
        .await
        .unwrap();

    let alice_account_account = token.get_account(alice_account).await.unwrap();
    let alice_account_token_account = token.get_account_info(&alice_account).await.unwrap();
    assert_eq!(alice_account_account.lamports, rent_exempt_lamports);
    assert_eq!(alice_account_token_account.base.amount, 0);

    let bob_account_account = token.get_account(bob_account).await.unwrap();
    assert_eq!(
        bob_account_account.lamports,
        amount + (amount - rent_exempt_lamports)
    );
}

#[tokio::test]
async fn self_owned() {
    let mut context = TestContext::new().await;
    context.init_token_with_native_mint().await.unwrap();
    run_self_owned_unwrap_lamports(context, TestMode::Regular).await;
}

#[tokio::test]
async fn self_owned_with_extensions() {
    let mut context = TestContext::new().await;
    context.init_token_with_native_mint().await.unwrap();
    run_self_owned_unwrap_lamports(context, TestMode::WithImmutableOwner).await;
}
