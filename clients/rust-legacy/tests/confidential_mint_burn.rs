mod program_test;
use {
    program_test::{ConfidentialTransferOption, TestContext, TokenContext},
    solana_program_test::tokio,
    solana_sdk::{
        instruction::InstructionError,
        pubkey::Pubkey,
        signature::Signer,
        signer::{keypair::Keypair, signers::Signers},
        transaction::TransactionError,
        transport::TransportError,
    },
    spl_token_2022::{
        error::TokenError,
        extension::{
            confidential_mint_burn::{
                account_info::{BurnAccountInfo, SupplyAccountInfo},
                ConfidentialMintBurn,
            },
            confidential_transfer::ConfidentialTransferAccount,
            BaseStateWithExtensions, ExtensionType,
        },
        solana_zk_sdk::encryption::{
            auth_encryption::*, elgamal::*, pod::elgamal::PodElGamalCiphertext,
        },
    },
    spl_token_client::{
        client::{ProgramBanksClientProcessTransaction, SendTransaction, SimulateTransaction},
        token::{
            ExtensionInitializationParams, ProofAccountWithCiphertext, Token,
            TokenError as TokenClientError, TokenResult,
        },
    },
    spl_token_confidential_transfer_proof_generation::{burn::BurnProofData, mint::MintProofData},
    std::convert::TryInto,
};

struct ConfidentialTokenAccountMeta {
    token_account: Pubkey,
    elgamal_keypair: ElGamalKeypair,
    aes_key: AeKey,
}

impl ConfidentialTokenAccountMeta {
    async fn new<T>(token: &Token<T>, owner: &Keypair) -> Self
    where
        T: SendTransaction + SimulateTransaction,
    {
        let token_account_keypair = Keypair::new();
        let extensions = vec![
            ExtensionType::ConfidentialTransferAccount,
            ExtensionType::ConfidentialMintBurn,
        ];

        token
            .create_auxiliary_token_account_with_extension_space(
                &token_account_keypair,
                &owner.pubkey(),
                extensions,
            )
            .await
            .unwrap();

        let token_account = token_account_keypair.pubkey();
        let elgamal_keypair =
            ElGamalKeypair::new_from_signer(owner, &token_account.to_bytes()).unwrap();
        let aes_key = AeKey::new_from_signer(owner, &token_account.to_bytes()).unwrap();

        token
            .confidential_transfer_configure_token_account(
                &token_account,
                &owner.pubkey(),
                None,
                None,
                &elgamal_keypair,
                &aes_key,
                &[owner],
            )
            .await
            .unwrap();

        Self {
            token_account,
            elgamal_keypair,
            aes_key,
        }
    }
}

#[tokio::test]
async fn confidential_mint_burn_config() {
    let confidential_transfer_authority = Keypair::new();
    let auto_approve_new_accounts = true;
    let auditor_elgamal_keypair = ElGamalKeypair::new_rand();
    let auditor_elgamal_pubkey = (*auditor_elgamal_keypair.pubkey()).into();

    let supply_elgamal_keypair = ElGamalKeypair::new_rand();
    let supply_elgamal_pubkey = (*supply_elgamal_keypair.pubkey()).into();

    let supply_aes_key = AeKey::new_rand();
    let decryptable_supply = supply_aes_key.encrypt(0).into();

    let mut context = TestContext::new().await;

    // Try invalid combinations of extensions
    let err = context
        .init_token_with_mint(vec![ExtensionInitializationParams::ConfidentialMintBurn {
            supply_elgamal_pubkey,
            decryptable_supply,
        }])
        .await
        .unwrap_err();

    assert_eq!(
        err,
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(
                2,
                InstructionError::Custom(TokenError::InvalidExtensionCombination as u32),
            )
        )))
    );

    context
        .init_token_with_mint(vec![
            ExtensionInitializationParams::ConfidentialTransferMint {
                authority: Some(confidential_transfer_authority.pubkey()),
                auto_approve_new_accounts,
                auditor_elgamal_pubkey: Some(auditor_elgamal_pubkey),
            },
            ExtensionInitializationParams::ConfidentialMintBurn {
                supply_elgamal_pubkey,
                decryptable_supply,
            },
        ])
        .await
        .unwrap();

    let TokenContext { token, .. } = context.token_context.unwrap();

    let state = token.get_mint_info().await.unwrap();
    let extension = state.get_extension::<ConfidentialMintBurn>().unwrap();

    assert_eq!(extension.supply_elgamal_pubkey, supply_elgamal_pubkey);
    assert_eq!(extension.decryptable_supply, decryptable_supply);
    assert_eq!(
        extension.confidential_supply,
        PodElGamalCiphertext::default()
    );
    assert_eq!(extension.pending_burn, PodElGamalCiphertext::default())
}

async fn rotate_supply_elgamal_pubkey<S: Signers>(
    token: &Token<ProgramBanksClientProcessTransaction>,
    authority: &Pubkey,
    current_supply_elgamal_keypair: &ElGamalKeypair,
    new_supply_elgamal_pubkey: &ElGamalPubkey,
    aes_key: &AeKey,
    signing_keypairs: &S,
    option: ConfidentialTransferOption,
) -> TokenResult<()> {
    match option {
        ConfidentialTransferOption::InstructionData => {
            token
                .confidential_transfer_rotate_supply_elgamal_pubkey(
                    authority,
                    current_supply_elgamal_keypair,
                    new_supply_elgamal_pubkey,
                    aes_key,
                    None,
                    None,
                    signing_keypairs,
                )
                .await
        }
        ConfidentialTransferOption::ContextStateAccount => {
            let state = token.get_mint_info().await.unwrap();
            let extension = state.get_extension::<ConfidentialMintBurn>().unwrap();
            let account_info = SupplyAccountInfo::new(extension);

            let proof_data = account_info
                .generate_rotate_supply_elgamal_pubkey_proof(
                    current_supply_elgamal_keypair,
                    new_supply_elgamal_pubkey,
                    aes_key,
                )
                .unwrap();

            let context_account = Keypair::new();
            let context_account_authority = Keypair::new();

            token
                .confidential_transfer_create_context_state_account(
                    &context_account.pubkey(),
                    &context_account_authority.pubkey(),
                    &proof_data,
                    false,
                    &[&context_account],
                )
                .await
                .unwrap();

            let result = token
                .confidential_transfer_rotate_supply_elgamal_pubkey(
                    authority,
                    current_supply_elgamal_keypair,
                    new_supply_elgamal_pubkey,
                    aes_key,
                    Some(&context_account.pubkey()),
                    None,
                    signing_keypairs,
                )
                .await;

            let lamport_destination = Keypair::new().pubkey();
            token
                .confidential_transfer_close_context_state_account(
                    &context_account.pubkey(),
                    &lamport_destination,
                    &context_account_authority.pubkey(),
                    &[&context_account_authority],
                )
                .await
                .unwrap();

            result
        }
    }
}

#[tokio::test]
async fn confidential_mint_burn_rotate_supply_elgamal_pubkey() {
    confidential_mint_burn_rotate_supply_elgamal_pubkey_with_option(
        ConfidentialTransferOption::InstructionData,
    )
    .await;
    confidential_mint_burn_rotate_supply_elgamal_pubkey_with_option(
        ConfidentialTransferOption::ContextStateAccount,
    )
    .await;
}

async fn confidential_mint_burn_rotate_supply_elgamal_pubkey_with_option(
    option: ConfidentialTransferOption,
) {
    let confidential_transfer_authority = Keypair::new();
    let auto_approve_new_accounts = true;
    let auditor_elgamal_keypair = ElGamalKeypair::new_rand();
    let auditor_elgamal_pubkey = (*auditor_elgamal_keypair.pubkey()).into();

    let supply_elgamal_keypair = ElGamalKeypair::new_rand();
    let supply_elgamal_pubkey = (*supply_elgamal_keypair.pubkey()).into();
    let supply_aes_key = AeKey::new_rand();
    let decryptable_supply = supply_aes_key.encrypt(0).into();

    let mut context = TestContext::new().await;
    context
        .init_token_with_mint(vec![
            ExtensionInitializationParams::ConfidentialTransferMint {
                authority: Some(confidential_transfer_authority.pubkey()),
                auto_approve_new_accounts,
                auditor_elgamal_pubkey: Some(auditor_elgamal_pubkey),
            },
            ExtensionInitializationParams::ConfidentialMintBurn {
                supply_elgamal_pubkey,
                decryptable_supply,
            },
        ])
        .await
        .unwrap();

    let TokenContext {
        token,
        mint_authority,
        alice,
        ..
    } = context.token_context.unwrap();

    let new_supply_elgamal_keypair = ElGamalKeypair::new_rand();
    let new_supply_elgamal_pubkey = new_supply_elgamal_keypair.pubkey();

    rotate_supply_elgamal_pubkey(
        &token,
        &mint_authority.pubkey(),
        &supply_elgamal_keypair,
        new_supply_elgamal_pubkey,
        &supply_aes_key,
        &[&mint_authority],
        option,
    )
    .await
    .unwrap();

    let state = token.get_mint_info().await.unwrap();
    let extension = state.get_extension::<ConfidentialMintBurn>().unwrap();

    // check that the new supply ElGamal public key is updated
    let expected_new_supply_elgamal_pubkey = (*new_supply_elgamal_pubkey).into();
    assert_eq!(
        extension.supply_elgamal_pubkey,
        expected_new_supply_elgamal_pubkey
    );

    // check that the new supply ElGamal keypair can decrypt the supply
    let confidential_supply: ElGamalCiphertext = extension.confidential_supply.try_into().unwrap();
    assert_eq!(
        confidential_supply
            .decrypt_u32(new_supply_elgamal_keypair.secret())
            .unwrap(),
        0
    );

    // check that rotation fails when pending burn is non-zero
    let alice_meta = ConfidentialTokenAccountMeta::new(&token, &alice).await;
    let mint_amount = 120;

    mint_with_option(
        &token,
        &mint_authority.pubkey(),
        &alice_meta.token_account,
        mint_amount,
        &new_supply_elgamal_keypair,
        alice_meta.elgamal_keypair.pubkey(),
        Some(auditor_elgamal_keypair.pubkey()),
        &supply_aes_key,
        &[&mint_authority],
        option,
    )
    .await
    .unwrap();

    token
        .confidential_transfer_apply_pending_balance(
            &alice_meta.token_account,
            &alice.pubkey(),
            None,
            alice_meta.elgamal_keypair.secret(),
            &alice_meta.aes_key,
            &[&alice],
        )
        .await
        .unwrap();

    burn_with_option(
        &token,
        &alice.pubkey(),
        &alice_meta.token_account,
        mint_amount,
        &alice_meta.elgamal_keypair,
        new_supply_elgamal_keypair.pubkey(),
        Some(auditor_elgamal_keypair.pubkey()),
        &alice_meta.aes_key,
        &[&alice],
        option,
    )
    .await
    .unwrap();

    let err = rotate_supply_elgamal_pubkey(
        &token,
        &mint_authority.pubkey(),
        &new_supply_elgamal_keypair,
        new_supply_elgamal_pubkey,
        &supply_aes_key,
        &[&mint_authority],
        option,
    )
    .await
    .unwrap_err();

    assert_eq!(
        err,
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(
                0,
                InstructionError::Custom(TokenError::PendingBalanceNonZero as u32),
            )
        )))
    );
}

#[tokio::test]
async fn confidential_mint_burn_update_decryptable_supply() {
    let confidential_transfer_authority = Keypair::new();
    let auto_approve_new_accounts = true;
    let auditor_elgamal_keypair = ElGamalKeypair::new_rand();
    let auditor_elgamal_pubkey = (*auditor_elgamal_keypair.pubkey()).into();

    let supply_elgamal_keypair = ElGamalKeypair::new_rand();
    let supply_elgamal_pubkey = (*supply_elgamal_keypair.pubkey()).into();
    let supply_aes_key = AeKey::new_rand();
    let decryptable_supply = supply_aes_key.encrypt(0).into();

    let mut context = TestContext::new().await;
    context
        .init_token_with_mint(vec![
            ExtensionInitializationParams::ConfidentialTransferMint {
                authority: Some(confidential_transfer_authority.pubkey()),
                auto_approve_new_accounts,
                auditor_elgamal_pubkey: Some(auditor_elgamal_pubkey),
            },
            ExtensionInitializationParams::ConfidentialMintBurn {
                supply_elgamal_pubkey,
                decryptable_supply,
            },
        ])
        .await
        .unwrap();

    let TokenContext {
        token,
        mint_authority,
        ..
    } = context.token_context.unwrap();

    let new_decryptable_supply = supply_aes_key.encrypt(0).into();
    token
        .confidential_transfer_update_decrypt_supply(
            &mint_authority.pubkey(),
            &new_decryptable_supply,
            &[&mint_authority],
        )
        .await
        .unwrap();

    let state = token.get_mint_info().await.unwrap();
    let extension = state.get_extension::<ConfidentialMintBurn>().unwrap();

    // check that the new decryptable supply is updated
    assert_eq!(extension.decryptable_supply, new_decryptable_supply,);
}

#[allow(clippy::too_many_arguments)]
async fn mint_with_option<S: Signers>(
    token: &Token<ProgramBanksClientProcessTransaction>,
    authority: &Pubkey,
    destination_account: &Pubkey,
    mint_amount: u64,
    supply_elgamal_keypair: &ElGamalKeypair,
    destination_elgamal_pubkey: &ElGamalPubkey,
    auditor_elgamal_pubkey: Option<&ElGamalPubkey>,
    aes_key: &AeKey,
    signing_keypairs: &S,
    option: ConfidentialTransferOption,
) -> TokenResult<()> {
    match option {
        ConfidentialTransferOption::InstructionData => {
            token
                .confidential_transfer_mint(
                    authority,
                    destination_account,
                    None,
                    None,
                    None,
                    mint_amount,
                    supply_elgamal_keypair,
                    destination_elgamal_pubkey,
                    auditor_elgamal_pubkey,
                    aes_key,
                    None,
                    signing_keypairs,
                )
                .await
        }
        ConfidentialTransferOption::ContextStateAccount => {
            let state = token.get_mint_info().await.unwrap();
            let extension = state.get_extension::<ConfidentialMintBurn>().unwrap();
            let account_info = SupplyAccountInfo::new(extension);

            let MintProofData {
                equality_proof_data,
                ciphertext_validity_proof_data_with_ciphertext,
                range_proof_data,
            } = account_info
                .generate_split_mint_proof_data(
                    mint_amount,
                    supply_elgamal_keypair,
                    aes_key,
                    destination_elgamal_pubkey,
                    auditor_elgamal_pubkey,
                )
                .unwrap();

            let mint_amount_auditor_ciphertext_lo =
                ciphertext_validity_proof_data_with_ciphertext.ciphertext_lo;
            let mint_amount_auditor_ciphertext_hi =
                ciphertext_validity_proof_data_with_ciphertext.ciphertext_hi;

            let equality_proof_context_account = Keypair::new();
            let ciphertext_validity_proof_context_account = Keypair::new();
            let range_proof_context_account = Keypair::new();
            let context_account_authority = Keypair::new();

            token
                .confidential_transfer_create_context_state_account(
                    &equality_proof_context_account.pubkey(),
                    &context_account_authority.pubkey(),
                    &equality_proof_data,
                    false,
                    &[&equality_proof_context_account],
                )
                .await
                .unwrap();

            token
                .confidential_transfer_create_context_state_account(
                    &ciphertext_validity_proof_context_account.pubkey(),
                    &context_account_authority.pubkey(),
                    &ciphertext_validity_proof_data_with_ciphertext.proof_data,
                    false,
                    &[&ciphertext_validity_proof_context_account],
                )
                .await
                .unwrap();

            token
                .confidential_transfer_create_context_state_account(
                    &range_proof_context_account.pubkey(),
                    &context_account_authority.pubkey(),
                    &range_proof_data,
                    false,
                    &[&range_proof_context_account],
                )
                .await
                .unwrap();

            let ciphertext_validity_proof_account_with_ciphertext = ProofAccountWithCiphertext {
                context_state_account: ciphertext_validity_proof_context_account.pubkey(),
                ciphertext_lo: mint_amount_auditor_ciphertext_lo,
                ciphertext_hi: mint_amount_auditor_ciphertext_hi,
            };

            let result = token
                .confidential_transfer_mint(
                    authority,
                    destination_account,
                    Some(&equality_proof_context_account.pubkey()),
                    Some(&ciphertext_validity_proof_account_with_ciphertext),
                    Some(&range_proof_context_account.pubkey()),
                    mint_amount,
                    supply_elgamal_keypair,
                    destination_elgamal_pubkey,
                    auditor_elgamal_pubkey,
                    aes_key,
                    None,
                    signing_keypairs,
                )
                .await;

            let lamport_destination_account = Keypair::new().pubkey();
            token
                .confidential_transfer_close_context_state_account(
                    &equality_proof_context_account.pubkey(),
                    &lamport_destination_account,
                    &context_account_authority.pubkey(),
                    &[&context_account_authority],
                )
                .await
                .unwrap();

            token
                .confidential_transfer_close_context_state_account(
                    &ciphertext_validity_proof_context_account.pubkey(),
                    &lamport_destination_account,
                    &context_account_authority.pubkey(),
                    &[&context_account_authority],
                )
                .await
                .unwrap();

            token
                .confidential_transfer_close_context_state_account(
                    &range_proof_context_account.pubkey(),
                    &lamport_destination_account,
                    &context_account_authority.pubkey(),
                    &[&context_account_authority],
                )
                .await
                .unwrap();

            result
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn burn_with_option<S: Signers>(
    token: &Token<ProgramBanksClientProcessTransaction>,
    authority: &Pubkey,
    source_account: &Pubkey,
    burn_amount: u64,
    source_elgamal_keypair: &ElGamalKeypair,
    supply_elgamal_pubkey: &ElGamalPubkey,
    auditor_elgamal_pubkey: Option<&ElGamalPubkey>,
    aes_key: &AeKey,
    signing_keypairs: &S,
    option: ConfidentialTransferOption,
) -> TokenResult<()> {
    match option {
        ConfidentialTransferOption::InstructionData => {
            token
                .confidential_transfer_burn(
                    authority,
                    source_account,
                    None,
                    None,
                    None,
                    burn_amount,
                    source_elgamal_keypair,
                    supply_elgamal_pubkey,
                    auditor_elgamal_pubkey,
                    aes_key,
                    None,
                    signing_keypairs,
                )
                .await
        }
        ConfidentialTransferOption::ContextStateAccount => {
            let state = token.get_account_info(source_account).await.unwrap();
            let extension = state
                .get_extension::<ConfidentialTransferAccount>()
                .unwrap();
            let account_info = BurnAccountInfo::new(extension);

            let BurnProofData {
                equality_proof_data,
                ciphertext_validity_proof_data_with_ciphertext,
                range_proof_data,
            } = account_info
                .generate_split_burn_proof_data(
                    burn_amount,
                    source_elgamal_keypair,
                    aes_key,
                    supply_elgamal_pubkey,
                    auditor_elgamal_pubkey,
                )
                .unwrap();

            let burn_amount_auditor_ciphertext_lo =
                ciphertext_validity_proof_data_with_ciphertext.ciphertext_lo;
            let burn_amount_auditor_ciphertext_hi =
                ciphertext_validity_proof_data_with_ciphertext.ciphertext_hi;

            let equality_proof_context_account = Keypair::new();
            let ciphertext_validity_proof_context_account = Keypair::new();
            let range_proof_context_account = Keypair::new();
            let context_account_authority = Keypair::new();

            token
                .confidential_transfer_create_context_state_account(
                    &equality_proof_context_account.pubkey(),
                    &context_account_authority.pubkey(),
                    &equality_proof_data,
                    false,
                    &[&equality_proof_context_account],
                )
                .await
                .unwrap();

            token
                .confidential_transfer_create_context_state_account(
                    &ciphertext_validity_proof_context_account.pubkey(),
                    &context_account_authority.pubkey(),
                    &ciphertext_validity_proof_data_with_ciphertext.proof_data,
                    false,
                    &[&ciphertext_validity_proof_context_account],
                )
                .await
                .unwrap();

            token
                .confidential_transfer_create_context_state_account(
                    &range_proof_context_account.pubkey(),
                    &context_account_authority.pubkey(),
                    &range_proof_data,
                    false,
                    &[&range_proof_context_account],
                )
                .await
                .unwrap();

            let ciphertext_validity_proof_account_with_ciphertext = ProofAccountWithCiphertext {
                context_state_account: ciphertext_validity_proof_context_account.pubkey(),
                ciphertext_lo: burn_amount_auditor_ciphertext_lo,
                ciphertext_hi: burn_amount_auditor_ciphertext_hi,
            };

            let result = token
                .confidential_transfer_burn(
                    authority,
                    source_account,
                    Some(&equality_proof_context_account.pubkey()),
                    Some(&ciphertext_validity_proof_account_with_ciphertext),
                    Some(&range_proof_context_account.pubkey()),
                    burn_amount,
                    source_elgamal_keypair,
                    supply_elgamal_pubkey,
                    auditor_elgamal_pubkey,
                    aes_key,
                    None,
                    signing_keypairs,
                )
                .await;

            let lamport_destination_account = Keypair::new().pubkey();
            token
                .confidential_transfer_close_context_state_account(
                    &equality_proof_context_account.pubkey(),
                    &lamport_destination_account,
                    &context_account_authority.pubkey(),
                    &[&context_account_authority],
                )
                .await
                .unwrap();

            token
                .confidential_transfer_close_context_state_account(
                    &ciphertext_validity_proof_context_account.pubkey(),
                    &lamport_destination_account,
                    &context_account_authority.pubkey(),
                    &[&context_account_authority],
                )
                .await
                .unwrap();

            token
                .confidential_transfer_close_context_state_account(
                    &range_proof_context_account.pubkey(),
                    &lamport_destination_account,
                    &context_account_authority.pubkey(),
                    &[&context_account_authority],
                )
                .await
                .unwrap();

            result
        }
    }
}

#[tokio::test]
async fn confidential_mint_burn() {
    confidential_mint_burn_with_option(ConfidentialTransferOption::InstructionData).await;
    confidential_mint_burn_with_option(ConfidentialTransferOption::ContextStateAccount).await;
}

async fn confidential_mint_burn_with_option(option: ConfidentialTransferOption) {
    let confidential_transfer_authority = Keypair::new();
    let auto_approve_new_accounts = true;
    let auditor_elgamal_keypair = ElGamalKeypair::new_rand();
    let auditor_elgamal_pubkey = (*auditor_elgamal_keypair.pubkey()).into();

    let supply_elgamal_keypair = ElGamalKeypair::new_rand();
    let supply_elgamal_pubkey = (*supply_elgamal_keypair.pubkey()).into();
    let supply_aes_key = AeKey::new_rand();
    let decryptable_supply = supply_aes_key.encrypt(0).into();

    let mut context = TestContext::new().await;
    context
        .init_token_with_mint(vec![
            ExtensionInitializationParams::ConfidentialTransferMint {
                authority: Some(confidential_transfer_authority.pubkey()),
                auto_approve_new_accounts,
                auditor_elgamal_pubkey: Some(auditor_elgamal_pubkey),
            },
            ExtensionInitializationParams::ConfidentialMintBurn {
                supply_elgamal_pubkey,
                decryptable_supply,
            },
        ])
        .await
        .unwrap();

    let TokenContext {
        token,
        mint_authority,
        alice,
        ..
    } = context.token_context.unwrap();

    let alice_meta = ConfidentialTokenAccountMeta::new(&token, &alice).await;
    let mint_amount = 120;

    mint_with_option(
        &token,
        &mint_authority.pubkey(),
        &alice_meta.token_account,
        mint_amount,
        &supply_elgamal_keypair,
        alice_meta.elgamal_keypair.pubkey(),
        Some(auditor_elgamal_keypair.pubkey()),
        &supply_aes_key,
        &[&mint_authority],
        option,
    )
    .await
    .unwrap();

    // check that the right amount is minted to the destination account
    let state = token
        .get_account_info(&alice_meta.token_account)
        .await
        .unwrap();
    let extension = state
        .get_extension::<ConfidentialTransferAccount>()
        .unwrap();

    assert_eq!(
        alice_meta
            .elgamal_keypair
            .secret()
            .decrypt_u32(&extension.pending_balance_lo.try_into().unwrap())
            .unwrap(),
        mint_amount
    );
    assert_eq!(
        alice_meta
            .elgamal_keypair
            .secret()
            .decrypt_u32(&extension.pending_balance_hi.try_into().unwrap())
            .unwrap(),
        0
    );

    // check that the supply in the mint is updated correctly
    let mint = token.get_mint_info().await.unwrap();
    let extension = mint.get_extension::<ConfidentialMintBurn>().unwrap();
    assert_eq!(
        supply_elgamal_keypair
            .secret()
            .decrypt_u32(&extension.confidential_supply.try_into().unwrap())
            .unwrap(),
        mint_amount
    );
    assert_eq!(
        supply_aes_key
            .decrypt(&extension.decryptable_supply.try_into().unwrap())
            .unwrap(),
        mint_amount
    );

    token
        .confidential_transfer_apply_pending_balance(
            &alice_meta.token_account,
            &alice.pubkey(),
            None,
            alice_meta.elgamal_keypair.secret(),
            &alice_meta.aes_key,
            &[&alice],
        )
        .await
        .unwrap();

    burn_with_option(
        &token,
        &alice.pubkey(),
        &alice_meta.token_account,
        mint_amount,
        &alice_meta.elgamal_keypair,
        supply_elgamal_keypair.pubkey(),
        Some(auditor_elgamal_keypair.pubkey()),
        &alice_meta.aes_key,
        &[&alice],
        option,
    )
    .await
    .unwrap();

    // check that the right amount is burned in the source account
    let state = token
        .get_account_info(&alice_meta.token_account)
        .await
        .unwrap();
    let extension = state
        .get_extension::<ConfidentialTransferAccount>()
        .unwrap();

    assert_eq!(
        alice_meta
            .elgamal_keypair
            .secret()
            .decrypt_u32(&extension.pending_balance_lo.try_into().unwrap())
            .unwrap(),
        0
    );
    assert_eq!(
        alice_meta
            .elgamal_keypair
            .secret()
            .decrypt_u32(&extension.pending_balance_hi.try_into().unwrap())
            .unwrap(),
        0
    );

    let mint = token.get_mint_info().await.unwrap();
    let extension = mint.get_extension::<ConfidentialMintBurn>().unwrap();
    // check that the pending burn in the mint is updated correctly
    assert_eq!(
        supply_elgamal_keypair
            .secret()
            .decrypt_u32(&extension.pending_burn.try_into().unwrap())
            .unwrap(),
        mint_amount
    );

    // the pending supply remains the same since the burn amount is not yet fully applied
    assert_eq!(
        supply_elgamal_keypair
            .secret()
            .decrypt_u32(&extension.pending_burn.try_into().unwrap())
            .unwrap(),
        mint_amount
    );

    // apply pending burn amount
    token
        .confidential_transfer_apply_pending_burn(&mint_authority.pubkey(), &[&mint_authority])
        .await
        .unwrap();

    let mint = token.get_mint_info().await.unwrap();
    let extension = mint.get_extension::<ConfidentialMintBurn>().unwrap();

    // the pending burn ciphertext should be zeroed out
    assert_eq!(extension.pending_burn, PodElGamalCiphertext::default());

    // the pending supply should now account the burn amounts
    assert_eq!(
        supply_elgamal_keypair
            .secret()
            .decrypt_u32(&extension.pending_burn.try_into().unwrap())
            .unwrap(),
        0,
    );

    // decryptable supply is not yet updated until it is manually updated
    assert_eq!(
        supply_aes_key
            .decrypt(&extension.decryptable_supply.try_into().unwrap())
            .unwrap(),
        mint_amount,
    );

    let new_decryptable_supply = supply_aes_key.encrypt(0).into();
    token
        .confidential_transfer_update_decrypt_supply(
            &mint_authority.pubkey(),
            &new_decryptable_supply,
            &[&mint_authority],
        )
        .await
        .unwrap();

    let mint = token.get_mint_info().await.unwrap();
    let extension = mint.get_extension::<ConfidentialMintBurn>().unwrap();
    assert_eq!(
        supply_aes_key
            .decrypt(&extension.decryptable_supply.try_into().unwrap())
            .unwrap(),
        0,
    );
}

#[tokio::test]
async fn pause_confidential_mint_burn() {
    let pausable_authority = Keypair::new();

    let confidential_transfer_authority = Keypair::new();
    let auto_approve_new_accounts = true;
    let auditor_elgamal_keypair = ElGamalKeypair::new_rand();
    let auditor_elgamal_pubkey = (*auditor_elgamal_keypair.pubkey()).into();

    let supply_elgamal_keypair = ElGamalKeypair::new_rand();
    let supply_elgamal_pubkey = (*supply_elgamal_keypair.pubkey()).into();
    let supply_aes_key = AeKey::new_rand();
    let decryptable_supply = supply_aes_key.encrypt(0).into();

    let mut context = TestContext::new().await;
    context
        .init_token_with_mint(vec![
            ExtensionInitializationParams::ConfidentialTransferMint {
                authority: Some(confidential_transfer_authority.pubkey()),
                auto_approve_new_accounts,
                auditor_elgamal_pubkey: Some(auditor_elgamal_pubkey),
            },
            ExtensionInitializationParams::ConfidentialMintBurn {
                supply_elgamal_pubkey,
                decryptable_supply,
            },
            ExtensionInitializationParams::PausableConfig {
                authority: pausable_authority.pubkey(),
            },
        ])
        .await
        .unwrap();

    let TokenContext {
        token,
        mint_authority,
        alice,
        ..
    } = context.token_context.unwrap();

    let alice_meta = ConfidentialTokenAccountMeta::new(&token, &alice).await;

    // add some token in advance to try burning later
    token
        .confidential_transfer_mint(
            &mint_authority.pubkey(),
            &alice_meta.token_account,
            None,
            None,
            None,
            120,
            &supply_elgamal_keypair,
            alice_meta.elgamal_keypair.pubkey(),
            Some(auditor_elgamal_keypair.pubkey()),
            &supply_aes_key,
            None,
            &[&mint_authority],
        )
        .await
        .unwrap();

    token
        .confidential_transfer_apply_pending_balance(
            &alice_meta.token_account,
            &alice.pubkey(),
            None,
            alice_meta.elgamal_keypair.secret(),
            &alice_meta.aes_key,
            &[&alice],
        )
        .await
        .unwrap();

    token
        .pause(&pausable_authority.pubkey(), &[&pausable_authority])
        .await
        .unwrap();

    let error = token
        .confidential_transfer_mint(
            &mint_authority.pubkey(),
            &alice_meta.token_account,
            None,
            None,
            None,
            10,
            &supply_elgamal_keypair,
            alice_meta.elgamal_keypair.pubkey(),
            Some(auditor_elgamal_keypair.pubkey()),
            &supply_aes_key,
            None,
            &[&mint_authority],
        )
        .await
        .unwrap_err();

    assert_eq!(
        error,
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(
                0,
                InstructionError::Custom(TokenError::MintPaused as u32)
            )
        )))
    );

    let error = token
        .confidential_transfer_burn(
            &alice.pubkey(),
            &alice_meta.token_account,
            None,
            None,
            None,
            10,
            &alice_meta.elgamal_keypair,
            supply_elgamal_keypair.pubkey(),
            Some(auditor_elgamal_keypair.pubkey()),
            &alice_meta.aes_key,
            None,
            &[&alice],
        )
        .await
        .unwrap_err();

    assert_eq!(
        error,
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(
                0,
                InstructionError::Custom(TokenError::MintPaused as u32)
            )
        )))
    );
}
