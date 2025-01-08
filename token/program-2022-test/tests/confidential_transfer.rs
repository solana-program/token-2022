#![cfg(feature = "test-bpf")]
#![cfg(twoxtx)]

mod program_test;
use {
    program_test::{TestContext, TokenContext},
    solana_program_test::tokio,
    solana_sdk::{
        epoch_info::EpochInfo, instruction::InstructionError, pubkey::Pubkey, signature::Signer,
        signer::keypair::Keypair, transaction::TransactionError, transport::TransportError,
    },
    spl_token_2022::{
        extension::{
            confidential_transfer::{
                ConfidentialTransferAccount, ConfidentialTransferMint, EncryptedWithheldAmount,
            },
            ExtensionType,
        },
        solana_zk_token_sdk::{
            encryption::{auth_encryption::*, elgamal::*},
            zk_token_elgamal::{self, pod::Zeroable},
        },
    },
    spl_token_client::{
        client::SendTransaction,
        token::{ExtensionInitializationParams, Token, TokenError as TokenClientError},
    },
    std::convert::TryInto,
};

const TEST_MAXIMUM_FEE: u64 = 100;
const TEST_FEE_BASIS_POINTS: u16 = 250;

fn test_epoch_info() -> EpochInfo {
    EpochInfo {
        epoch: 0,
        slot_index: 0,
        slots_in_epoch: 0,
        absolute_slot: 0,
        block_height: 0,
        transaction_count: None,
    }
}

struct ConfidentialTransferMintWithKeypairs {
    ct_mint: ConfidentialTransferMint,
    ct_mint_authority: Keypair,
    #[allow(dead_code)]
    ct_mint_transfer_auditor_encryption_keypair: ElGamalKeypair,
    ct_mint_withdraw_withheld_authority_encryption_keypair: ElGamalKeypair,
}

impl ConfidentialTransferMintWithKeypairs {
    fn new() -> Self {
        let ct_mint_authority = Keypair::new();
        let ct_mint_transfer_auditor_encryption_keypair = ElGamalKeypair::new_rand();
        let ct_mint_withdraw_withheld_authority_encryption_keypair = ElGamalKeypair::new_rand();
        let ct_mint = ConfidentialTransferMint {
            authority: ct_mint_authority.pubkey().into(),
            auto_approve_new_accounts: true.into(),
            auditor_encryption_pubkey: ct_mint_transfer_auditor_encryption_keypair.public.into(),
            withdraw_withheld_authority_encryption_pubkey:
                ct_mint_withdraw_withheld_authority_encryption_keypair
                    .public
                    .into(),
            withheld_amount: EncryptedWithheldAmount::zeroed(),
        };
        Self {
            ct_mint,
            ct_mint_authority,
            ct_mint_transfer_auditor_encryption_keypair,
            ct_mint_withdraw_withheld_authority_encryption_keypair,
        }
    }

    fn without_auto_approve() -> Self {
        let mut x = Self::new();
        x.ct_mint.auto_approve_new_accounts = false.into();
        x
    }
}

struct ConfidentialTokenAccountMeta {
    token_account: Pubkey,
    elgamal_keypair: ElGamalKeypair,
    ae_key: AeKey,
}

impl ConfidentialTokenAccountMeta {
    async fn new<T>(token: &Token<T, Keypair>, owner: &Keypair) -> Self
    where
        T: SendTransaction,
    {
        let token_account = token
            .create_auxiliary_token_account_with_extension_space(
                &Keypair::new(),
                &owner.pubkey(),
                vec![ExtensionType::ConfidentialTransferAccount],
            )
            .await
            .unwrap();

        let (elgamal_keypair, ae_key) = token
            .confidential_transfer_configure_token_account_and_keypairs(&token_account, owner)
            .await
            .unwrap();

        Self {
            token_account,
            elgamal_keypair,
            ae_key,
        }
    }

    async fn with_tokens<T>(
        token: &Token<T, Keypair>,
        owner: &Keypair,
        mint_authority: &Keypair,
        amount: u64,
        decimals: u8,
    ) -> Self
    where
        T: SendTransaction,
    {
        let meta = Self::new(token, owner).await;

        token
            .mint_to(&meta.token_account, mint_authority, amount)
            .await
            .unwrap();

        token
            .confidential_transfer_deposit(
                &meta.token_account,
                &meta.token_account,
                owner,
                amount,
                decimals,
            )
            .await
            .unwrap();

        token
            .confidential_transfer_apply_pending_balance(
                &meta.token_account,
                owner,
                1,
                meta.ae_key.encrypt(amount),
            )
            .await
            .unwrap();
        meta
    }

    async fn check_balances<T>(
        &self,
        token: &Token<T, Keypair>,
        expected: ConfidentialTokenAccountBalances,
    ) where
        T: SendTransaction,
    {
        let state = token.get_account_info(&self.token_account).await.unwrap();
        let extension = state
            .get_extension::<ConfidentialTransferAccount>()
            .unwrap();

        assert_eq!(
            extension
                .pending_balance
                .decrypt(&self.elgamal_keypair.secret)
                .unwrap(),
            expected.pending_balance,
        );
        assert_eq!(
            extension
                .available_balance
                .decrypt(&self.elgamal_keypair.secret)
                .unwrap(),
            expected.available_balance,
        );
        assert_eq!(
            self.ae_key
                .decrypt(&extension.decryptable_available_balance.try_into().unwrap())
                .unwrap(),
            expected.decryptable_available_balance,
        );
    }
}

struct ConfidentialTokenAccountBalances {
    pending_balance: u64,
    available_balance: u64,
    decryptable_available_balance: u64,
}

async fn check_withheld_amount_in_mint<T>(
    token: &Token<T, Keypair>,
    withdraw_withheld_authority_encryption_keypair: &ElGamalKeypair,
    expected: u64,
) where
    T: SendTransaction,
{
    let state = token.get_mint_info().await.unwrap();
    let extension = state.get_extension::<ConfidentialTransferMint>().unwrap();
    let decrypted_amount = extension
        .withheld_amount
        .decrypt(&withdraw_withheld_authority_encryption_keypair.secret)
        .unwrap();
    assert_eq!(decrypted_amount, expected);
}

#[tokio::test]
async fn ct_initialize_and_update_mint() {
    let wrong_keypair = Keypair::new();

    let ConfidentialTransferMintWithKeypairs {
        ct_mint,
        ct_mint_authority,
        ..
    } = ConfidentialTransferMintWithKeypairs::new();
    let mut context = TestContext::new().await;
    context
        .init_token_with_mint(vec![
            ExtensionInitializationParams::ConfidentialTransferMint { ct_mint },
        ])
        .await
        .unwrap();

    let TokenContext { token, .. } = context.token_context.unwrap();

    let state = token.get_mint_info().await.unwrap();
    let extension = state.get_extension::<ConfidentialTransferMint>().unwrap();
    assert_eq!(*extension, ct_mint);

    // Change the authority
    let new_ct_mint_authority = Keypair::new();
    let new_ct_mint = ConfidentialTransferMint {
        authority: new_ct_mint_authority.pubkey(),
        ..ConfidentialTransferMint::default()
    };

    let err = token
        .confidential_transfer_update_mint(
            &wrong_keypair,
            new_ct_mint,
            Some(&new_ct_mint_authority),
        )
        .await
        .unwrap_err();
    assert_eq!(
        err,
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::MissingRequiredSignature)
        )))
    );
    token
        .confidential_transfer_update_mint(
            &ct_mint_authority,
            new_ct_mint,
            Some(&new_ct_mint_authority),
        )
        .await
        .unwrap();

    let state = token.get_mint_info().await.unwrap();
    let extension = state.get_extension::<ConfidentialTransferMint>().unwrap();
    assert_eq!(*extension, new_ct_mint);

    // Clear the authority
    let new_ct_mint = ConfidentialTransferMint::default();
    token
        .confidential_transfer_update_mint(&new_ct_mint_authority, new_ct_mint, None)
        .await
        .unwrap();

    let state = token.get_mint_info().await.unwrap();
    let extension = state.get_extension::<ConfidentialTransferMint>().unwrap();
    assert_eq!(*extension, new_ct_mint);
}

#[tokio::test]
async fn ct_configure_token_account() {
    let ConfidentialTransferMintWithKeypairs {
        ct_mint,
        ct_mint_authority,
        ..
    } = ConfidentialTransferMintWithKeypairs::without_auto_approve();

    let mut context = TestContext::new().await;
    context
        .init_token_with_mint(vec![
            ExtensionInitializationParams::ConfidentialTransferMint { ct_mint },
        ])
        .await
        .unwrap();

    let TokenContext { token, alice, .. } = context.token_context.unwrap();
    let alice_meta = ConfidentialTokenAccountMeta::new(&token, &alice).await;

    let state = token
        .get_account_info(&alice_meta.token_account)
        .await
        .unwrap();
    let extension = state
        .get_extension::<ConfidentialTransferAccount>()
        .unwrap();
    assert!(!bool::from(&extension.approved));
    assert!(bool::from(&extension.allow_balance_credits));
    assert_eq!(
        extension.encryption_pubkey,
        alice_meta.elgamal_keypair.public.into()
    );
    assert_eq!(
        alice_meta
            .ae_key
            .decrypt(&(extension.decryptable_available_balance.try_into().unwrap()))
            .unwrap(),
        0
    );

    token
        .confidential_transfer_approve_account(&alice_meta.token_account, &ct_mint_authority)
        .await
        .unwrap();

    let state = token
        .get_account_info(&alice_meta.token_account)
        .await
        .unwrap();
    let extension = state
        .get_extension::<ConfidentialTransferAccount>()
        .unwrap();
    assert!(bool::from(&extension.approved));
}

#[tokio::test]
async fn ct_enable_disable_balance_credits() {
    let ConfidentialTransferMintWithKeypairs { ct_mint, .. } =
        ConfidentialTransferMintWithKeypairs::new();
    let mut context = TestContext::new().await;
    context
        .init_token_with_mint(vec![
            ExtensionInitializationParams::ConfidentialTransferMint { ct_mint },
        ])
        .await
        .unwrap();

    let TokenContext { token, alice, .. } = context.token_context.unwrap();
    let alice_meta = ConfidentialTokenAccountMeta::new(&token, &alice).await;

    token
        .confidential_transfer_disable_balance_credits(&alice_meta.token_account, &alice)
        .await
        .unwrap();
    let state = token
        .get_account_info(&alice_meta.token_account)
        .await
        .unwrap();
    let extension = state
        .get_extension::<ConfidentialTransferAccount>()
        .unwrap();
    assert!(!bool::from(&extension.allow_balance_credits));

    token
        .confidential_transfer_enable_balance_credits(&alice_meta.token_account, &alice)
        .await
        .unwrap();
    let state = token
        .get_account_info(&alice_meta.token_account)
        .await
        .unwrap();
    let extension = state
        .get_extension::<ConfidentialTransferAccount>()
        .unwrap();
    assert!(bool::from(&extension.allow_balance_credits));
}

#[tokio::test]
async fn ct_new_account_is_empty() {
    let ConfidentialTransferMintWithKeypairs { ct_mint, .. } =
        ConfidentialTransferMintWithKeypairs::new();
    let mut context = TestContext::new().await;
    context
        .init_token_with_mint(vec![
            ExtensionInitializationParams::ConfidentialTransferMint { ct_mint },
        ])
        .await
        .unwrap();

    let TokenContext { token, alice, .. } = context.token_context.unwrap();

    let alice_meta = ConfidentialTokenAccountMeta::new(&token, &alice).await;
    token
        .confidential_transfer_empty_account(
            &alice_meta.token_account,
            &alice,
            &alice_meta.elgamal_keypair,
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn ct_deposit() {
    let ConfidentialTransferMintWithKeypairs { ct_mint, .. } =
        ConfidentialTransferMintWithKeypairs::new();
    let mut context = TestContext::new().await;
    context
        .init_token_with_mint(vec![
            ExtensionInitializationParams::ConfidentialTransferMint { ct_mint },
        ])
        .await
        .unwrap();

    let TokenContext {
        token,
        alice,
        mint_authority,
        decimals,
        ..
    } = context.token_context.unwrap();
    let alice_meta = ConfidentialTokenAccountMeta::new(&token, &alice).await;

    token
        .mint_to(&alice_meta.token_account, &mint_authority, 42)
        .await
        .unwrap();

    let state = token
        .get_account_info(&alice_meta.token_account)
        .await
        .unwrap();
    assert_eq!(state.base.amount, 42);
    let extension = state
        .get_extension::<ConfidentialTransferAccount>()
        .unwrap();
    assert_eq!(extension.pending_balance_credit_counter, 0.into());
    assert_eq!(extension.expected_pending_balance_credit_counter, 0.into());
    assert_eq!(extension.actual_pending_balance_credit_counter, 0.into());
    assert_eq!(
        extension.pending_balance,
        zk_token_elgamal::pod::ElGamalCiphertext::zeroed()
    );
    assert_eq!(
        extension.available_balance,
        zk_token_elgamal::pod::ElGamalCiphertext::zeroed()
    );

    token
        .confidential_transfer_deposit(
            &alice_meta.token_account,
            &alice_meta.token_account,
            &alice,
            42,
            decimals,
        )
        .await
        .unwrap();

    let state = token
        .get_account_info(&alice_meta.token_account)
        .await
        .unwrap();
    assert_eq!(state.base.amount, 0);
    let extension = state
        .get_extension::<ConfidentialTransferAccount>()
        .unwrap();
    assert_eq!(extension.pending_balance_credit_counter, 1.into());
    assert_eq!(extension.expected_pending_balance_credit_counter, 0.into());
    assert_eq!(extension.actual_pending_balance_credit_counter, 0.into());

    alice_meta
        .check_balances(
            &token,
            ConfidentialTokenAccountBalances {
                pending_balance: 42,
                available_balance: 0,
                decryptable_available_balance: 0,
            },
        )
        .await;

    let new_decryptable_available_balance = alice_meta.ae_key.encrypt(42_u64);
    token
        .confidential_transfer_apply_pending_balance(
            &alice_meta.token_account,
            &alice,
            1,
            new_decryptable_available_balance.clone(),
        )
        .await
        .unwrap();

    let state = token
        .get_account_info(&alice_meta.token_account)
        .await
        .unwrap();
    let extension = state
        .get_extension::<ConfidentialTransferAccount>()
        .unwrap();
    assert_eq!(
        extension.decryptable_available_balance,
        new_decryptable_available_balance.into(),
    );
    assert_eq!(extension.pending_balance_credit_counter, 1.into());
    assert_eq!(extension.expected_pending_balance_credit_counter, 1.into());
    assert_eq!(extension.actual_pending_balance_credit_counter, 1.into());

    alice_meta
        .check_balances(
            &token,
            ConfidentialTokenAccountBalances {
                pending_balance: 0,
                available_balance: 42,
                decryptable_available_balance: 42,
            },
        )
        .await;
}

#[tokio::test]
async fn ct_withdraw() {
    let ConfidentialTransferMintWithKeypairs { ct_mint, .. } =
        ConfidentialTransferMintWithKeypairs::new();
    let mut context = TestContext::new().await;
    context
        .init_token_with_mint(vec![
            ExtensionInitializationParams::ConfidentialTransferMint { ct_mint },
        ])
        .await
        .unwrap();

    let TokenContext {
        token,
        alice,
        mint_authority,
        decimals,
        ..
    } = context.token_context.unwrap();

    let alice_meta =
        ConfidentialTokenAccountMeta::with_tokens(&token, &alice, &mint_authority, 42, decimals)
            .await;

    let state = token
        .get_account_info(&alice_meta.token_account)
        .await
        .unwrap();
    assert_eq!(state.base.amount, 0);

    token
        .confidential_transfer_withdraw(
            &alice_meta.token_account,
            &alice_meta.token_account,
            &alice,
            21,
            decimals,
            42,
            &alice_meta.elgamal_keypair,
            alice_meta.ae_key.encrypt(42_u64 - 21),
        )
        .await
        .unwrap();

    let state = token
        .get_account_info(&alice_meta.token_account)
        .await
        .unwrap();
    assert_eq!(state.base.amount, 21);

    alice_meta
        .check_balances(
            &token,
            ConfidentialTokenAccountBalances {
                pending_balance: 0,
                available_balance: 21,
                decryptable_available_balance: 21,
            },
        )
        .await;

    token
        .confidential_transfer_withdraw(
            &alice_meta.token_account,
            &alice_meta.token_account,
            &alice,
            21,
            decimals,
            21,
            &alice_meta.elgamal_keypair,
            alice_meta.ae_key.encrypt(0u64),
        )
        .await
        .unwrap();

    let state = token
        .get_account_info(&alice_meta.token_account)
        .await
        .unwrap();
    assert_eq!(state.base.amount, 42);

    alice_meta
        .check_balances(
            &token,
            ConfidentialTokenAccountBalances {
                pending_balance: 0,
                available_balance: 0,
                decryptable_available_balance: 0,
            },
        )
        .await;

    token
        .confidential_transfer_empty_account(
            &alice_meta.token_account,
            &alice,
            &alice_meta.elgamal_keypair,
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn ct_transfer() {
    let ConfidentialTransferMintWithKeypairs { ct_mint, .. } =
        ConfidentialTransferMintWithKeypairs::new();
    let mut context = TestContext::new().await;
    context
        .init_token_with_mint(vec![
            ExtensionInitializationParams::ConfidentialTransferMint { ct_mint },
        ])
        .await
        .unwrap();

    let TokenContext {
        token,
        alice,
        bob,
        mint_authority,
        decimals,
        ..
    } = context.token_context.unwrap();
    let alice_meta =
        ConfidentialTokenAccountMeta::with_tokens(&token, &alice, &mint_authority, 42, decimals)
            .await;
    let bob_meta = ConfidentialTokenAccountMeta::new(&token, &bob).await;

    // Self-transfer of 0 tokens
    token
        .confidential_transfer_transfer(
            &alice_meta.token_account,
            &alice_meta.token_account,
            &alice,
            0,  // amount
            42, // available balance
            &alice_meta.elgamal_keypair,
            alice_meta.ae_key.encrypt(42_u64),
        )
        .await
        .unwrap();

    alice_meta
        .check_balances(
            &token,
            ConfidentialTokenAccountBalances {
                pending_balance: 0,
                available_balance: 42,
                decryptable_available_balance: 42,
            },
        )
        .await;

    // Self-transfer of N tokens
    token
        .confidential_transfer_transfer(
            &alice_meta.token_account,
            &alice_meta.token_account,
            &alice,
            42, // amount
            42, // available balance
            &alice_meta.elgamal_keypair,
            alice_meta.ae_key.encrypt(0_u64),
        )
        .await
        .unwrap();

    alice_meta
        .check_balances(
            &token,
            ConfidentialTokenAccountBalances {
                pending_balance: 42,
                available_balance: 0,
                decryptable_available_balance: 0,
            },
        )
        .await;

    token
        .confidential_transfer_apply_pending_balance(
            &alice_meta.token_account,
            &alice,
            2,
            alice_meta.ae_key.encrypt(42_u64),
        )
        .await
        .unwrap();

    alice_meta
        .check_balances(
            &token,
            ConfidentialTokenAccountBalances {
                pending_balance: 0,
                available_balance: 42,
                decryptable_available_balance: 42,
            },
        )
        .await;

    token
        .confidential_transfer_transfer(
            &alice_meta.token_account,
            &bob_meta.token_account,
            &alice,
            42, // amount
            42, // available balance
            &alice_meta.elgamal_keypair,
            alice_meta.ae_key.encrypt(0_u64),
        )
        .await
        .unwrap();

    alice_meta
        .check_balances(
            &token,
            ConfidentialTokenAccountBalances {
                pending_balance: 0,
                available_balance: 0,
                decryptable_available_balance: 0,
            },
        )
        .await;

    token
        .confidential_transfer_empty_account(
            &alice_meta.token_account,
            &alice,
            &alice_meta.elgamal_keypair,
        )
        .await
        .unwrap();

    let err = token
        .confidential_transfer_empty_account(
            &bob_meta.token_account,
            &bob,
            &bob_meta.elgamal_keypair,
        )
        .await
        .unwrap_err();
    assert_eq!(
        err,
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(1, InstructionError::InvalidAccountData)
        )))
    );

    let state = token
        .get_account_info(&bob_meta.token_account)
        .await
        .unwrap();
    let extension = state
        .get_extension::<ConfidentialTransferAccount>()
        .unwrap();

    // TODO: verify bob_meta pending and available balance once syscall lands
    assert_eq!(
        bob_meta
            .ae_key
            .decrypt(&extension.decryptable_available_balance.try_into().unwrap()),
        Some(0),
    );

    token
        .confidential_transfer_apply_pending_balance(
            &bob_meta.token_account,
            &bob,
            1,
            bob_meta.ae_key.encrypt(42_u64),
        )
        .await
        .unwrap();

    let state = token
        .get_account_info(&bob_meta.token_account)
        .await
        .unwrap();
    let extension = state
        .get_extension::<ConfidentialTransferAccount>()
        .unwrap();

    // TODO: verify bob_meta pending and available balance once syscall lands
    assert_eq!(
        bob_meta
            .ae_key
            .decrypt(&extension.decryptable_available_balance.try_into().unwrap()),
        Some(42),
    );
}

#[tokio::test]
async fn ct_transfer_with_fee() {
    let ConfidentialTransferMintWithKeypairs { ct_mint, .. } =
        ConfidentialTransferMintWithKeypairs::new();

    let mut context = TestContext::new().await;
    context
        .init_token_with_mint(vec![
            ExtensionInitializationParams::TransferFeeConfig {
                transfer_fee_config_authority: Some(Pubkey::new_unique()),
                withdraw_withheld_authority: Some(Pubkey::new_unique()),
                transfer_fee_basis_points: TEST_FEE_BASIS_POINTS,
                maximum_fee: TEST_MAXIMUM_FEE,
            },
            ExtensionInitializationParams::ConfidentialTransferMint { ct_mint },
        ])
        .await
        .unwrap();

    let TokenContext {
        token,
        alice,
        bob,
        mint_authority,
        decimals,
        ..
    } = context.token_context.unwrap();

    let epoch_info = test_epoch_info();

    let alice_meta =
        ConfidentialTokenAccountMeta::with_tokens(&token, &alice, &mint_authority, 100, decimals)
            .await;
    let bob_meta = ConfidentialTokenAccountMeta::new(&token, &bob).await;

    // Self-transfer of 0 tokens
    token
        .confidential_transfer_transfer_with_fee(
            &alice_meta.token_account,
            &alice_meta.token_account,
            &alice,
            0,   // amount
            100, // available balance
            &alice_meta.elgamal_keypair,
            alice_meta.ae_key.encrypt(100_u64),
            &epoch_info,
        )
        .await
        .unwrap();

    alice_meta
        .check_balances(
            &token,
            ConfidentialTokenAccountBalances {
                pending_balance: 0,
                available_balance: 100,
                decryptable_available_balance: 100,
            },
        )
        .await;

    // Self-transfers does not incur a fee
    token
        .confidential_transfer_transfer_with_fee(
            &alice_meta.token_account,
            &alice_meta.token_account,
            &alice,
            100, // amount
            100, // available balance
            &alice_meta.elgamal_keypair,
            alice_meta.ae_key.encrypt(0_u64),
            &epoch_info,
        )
        .await
        .unwrap();

    alice_meta
        .check_balances(
            &token,
            ConfidentialTokenAccountBalances {
                pending_balance: 100,
                available_balance: 0,
                decryptable_available_balance: 0,
            },
        )
        .await;

    token
        .confidential_transfer_apply_pending_balance(
            &alice_meta.token_account,
            &alice,
            2,
            alice_meta.ae_key.encrypt(100_u64),
        )
        .await
        .unwrap();

    alice_meta
        .check_balances(
            &token,
            ConfidentialTokenAccountBalances {
                pending_balance: 0,
                available_balance: 100,
                decryptable_available_balance: 100,
            },
        )
        .await;

    token
        .confidential_transfer_transfer_with_fee(
            &alice_meta.token_account,
            &bob_meta.token_account,
            &alice,
            100, // amount
            100, // available balance
            &alice_meta.elgamal_keypair,
            alice_meta.ae_key.encrypt(0_u64),
            &epoch_info,
        )
        .await
        .unwrap();

    alice_meta
        .check_balances(
            &token,
            ConfidentialTokenAccountBalances {
                pending_balance: 0,
                available_balance: 0,
                decryptable_available_balance: 0,
            },
        )
        .await;

    let state = token
        .get_account_info(&alice_meta.token_account)
        .await
        .unwrap();
    let extension = state
        .get_extension::<ConfidentialTransferAccount>()
        .unwrap();
    assert_eq!(
        alice_meta
            .ae_key
            .decrypt(&extension.decryptable_available_balance.try_into().unwrap()),
        Some(0),
    );

    // Alice account cannot be closed since there are withheld fees from self-transfer
    token
        .confidential_transfer_empty_account(
            &alice_meta.token_account,
            &alice,
            &alice_meta.elgamal_keypair,
        )
        .await
        .unwrap();

    let err = token
        .confidential_transfer_empty_account(
            &bob_meta.token_account,
            &bob,
            &bob_meta.elgamal_keypair,
        )
        .await
        .unwrap_err();
    assert_eq!(
        err,
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(1, InstructionError::InvalidAccountData)
        )))
    );

    let state = token
        .get_account_info(&bob_meta.token_account)
        .await
        .unwrap();
    let extension = state
        .get_extension::<ConfidentialTransferAccount>()
        .unwrap();

    // TODO: check pending and available balance once curve syscall lands
    assert_eq!(
        bob_meta
            .ae_key
            .decrypt(&extension.decryptable_available_balance.try_into().unwrap()),
        Some(0),
    );

    token
        .confidential_transfer_apply_pending_balance(
            &bob_meta.token_account,
            &bob,
            1,
            bob_meta.ae_key.encrypt(94_u64),
        )
        .await
        .unwrap();

    let state = token
        .get_account_info(&bob_meta.token_account)
        .await
        .unwrap();
    let extension = state
        .get_extension::<ConfidentialTransferAccount>()
        .unwrap();

    // TODO: check pending and available balance once curve syscall lands
    assert_eq!(
        bob_meta
            .ae_key
            .decrypt(&extension.decryptable_available_balance.try_into().unwrap()),
        Some(94),
    );
}

#[tokio::test]
async fn ct_withdraw_withheld_tokens_from_mint() {
    let ConfidentialTransferMintWithKeypairs {
        ct_mint,
        ct_mint_withdraw_withheld_authority_encryption_keypair,
        ..
    } = ConfidentialTransferMintWithKeypairs::new();

    let ct_mint_withdraw_withheld_authority = Keypair::new();

    let mut context = TestContext::new().await;
    context
        .init_token_with_mint(vec![
            ExtensionInitializationParams::TransferFeeConfig {
                transfer_fee_config_authority: Some(Pubkey::new_unique()),
                withdraw_withheld_authority: Some(ct_mint_withdraw_withheld_authority.pubkey()),
                transfer_fee_basis_points: TEST_FEE_BASIS_POINTS,
                maximum_fee: TEST_MAXIMUM_FEE,
            },
            ExtensionInitializationParams::ConfidentialTransferMint { ct_mint },
        ])
        .await
        .unwrap();

    let TokenContext {
        token,
        alice,
        bob,
        mint_authority,
        decimals,
        ..
    } = context.token_context.unwrap();

    let epoch_info = test_epoch_info();

    let alice_meta =
        ConfidentialTokenAccountMeta::with_tokens(&token, &alice, &mint_authority, 100, decimals)
            .await;
    let bob_meta = ConfidentialTokenAccountMeta::new(&token, &bob).await;

    token
        .confidential_transfer_withdraw_withheld_tokens_from_mint(
            &ct_mint_withdraw_withheld_authority,
            &ct_mint_withdraw_withheld_authority_encryption_keypair,
            &alice_meta.token_account,
            0_u64,
        )
        .await
        .unwrap();

    alice_meta
        .check_balances(
            &token,
            ConfidentialTokenAccountBalances {
                pending_balance: 0,
                available_balance: 100,
                decryptable_available_balance: 100,
            },
        )
        .await;

    check_withheld_amount_in_mint(
        &token,
        &ct_mint_withdraw_withheld_authority_encryption_keypair,
        0,
    )
    .await;

    // Test fee is 2.5% so the withheld fees should be 3
    token
        .confidential_transfer_transfer_with_fee(
            &alice_meta.token_account,
            &bob_meta.token_account,
            &alice,
            100,
            100,
            &alice_meta.elgamal_keypair,
            alice_meta.ae_key.encrypt(0_u64),
            &epoch_info,
        )
        .await
        .unwrap();

    let state = token
        .get_account_info(&bob_meta.token_account)
        .await
        .unwrap();
    let extension = state
        .get_extension::<ConfidentialTransferAccount>()
        .unwrap();

    assert_eq!(
        extension
            .withheld_amount
            .decrypt(&ct_mint_withdraw_withheld_authority_encryption_keypair.secret),
        Some(3),
    );

    token
        .confidential_transfer_harvest_withheld_tokens_to_mint(&[&bob_meta.token_account])
        .await
        .unwrap();

    check_withheld_amount_in_mint(
        &token,
        &ct_mint_withdraw_withheld_authority_encryption_keypair,
        3,
    )
    .await;

    token
        .confidential_transfer_withdraw_withheld_tokens_from_mint(
            &ct_mint_withdraw_withheld_authority,
            &ct_mint_withdraw_withheld_authority_encryption_keypair,
            &alice_meta.token_account,
            3_u64,
        )
        .await
        .unwrap();

    alice_meta
        .check_balances(
            &token,
            ConfidentialTokenAccountBalances {
                pending_balance: 3,
                available_balance: 0,
                decryptable_available_balance: 0,
            },
        )
        .await;
}
