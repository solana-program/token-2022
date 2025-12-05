mod program_test;
use {
    program_test::{TestContext, TokenContext},
    solana_program_test::tokio,
    solana_sdk::{
        instruction::InstructionError, pubkey::Pubkey, signature::Signer, signer::keypair::Keypair,
        transaction::TransactionError, transport::TransportError,
    },
    spl_token_2022_interface::{
        error::TokenError,
        instruction::AuthorityType,
        extension::{
            permissioned_burn::{
                instruction as permissioned_burn_instruction, PermissionedBurnConfig,
            },
            BaseStateWithExtensions,
        },
    },
    spl_token_client::token::{ExtensionInitializationParams, TokenError as TokenClientError},
};

fn client_error(token_error: TokenError) -> TokenClientError {
    TokenClientError::Client(Box::new(TransportError::TransactionError(
        TransactionError::InstructionError(0, InstructionError::Custom(token_error as u32)),
    )))
}

#[tokio::test]
async fn success_initialize() {
    let mut context = TestContext::new().await;
    let authority = Keypair::new();
    context
        .init_token_with_mint(vec![
            ExtensionInitializationParams::PermissionedBurnConfig {
                authority: authority.pubkey(),
            },
        ])
        .await
        .unwrap();

    let TokenContext { token, .. } = context.token_context.unwrap();
    let state = token.get_mint_info().await.unwrap();
    let extension = state.get_extension::<PermissionedBurnConfig>().unwrap();

    assert_eq!(
        Option::<Pubkey>::from(extension.authority),
        Some(authority.pubkey())
    );
}

#[tokio::test]
async fn permissioned_burn_enforced() {
    let mut context = TestContext::new().await;
    let authority = Keypair::new();
    let new_authority = Keypair::new();
    context
        .init_token_with_mint(vec![
            ExtensionInitializationParams::PermissionedBurnConfig {
                authority: authority.pubkey(),
            },
        ])
        .await
        .unwrap();

    let TokenContext {
        token,
        mint_authority,
        decimals,
        ..
    } = context.token_context.unwrap();

    let account_owner = Keypair::new();
    token
        .create_auxiliary_token_account(&account_owner, &account_owner.pubkey())
        .await
        .unwrap();
    let account = account_owner.pubkey();

    // Mint some supply
    token
        .mint_to(&account, &mint_authority.pubkey(), 2, &[&mint_authority])
        .await
        .unwrap();

    // Standard burn should be rejected when the permissioned extension is set.
    let error = token
        .burn(&account, &account_owner.pubkey(), 1, &[&account_owner])
        .await
        .unwrap_err();
    assert_eq!(error, client_error(TokenError::InvalidInstruction));

    // Permissioned burn with the wrong permissioned authority fails.
    let wrong_permissioned = Keypair::new();
    let ix_wrong = permissioned_burn_instruction::burn_checked(
        &spl_token_2022_interface::id(),
        &account,
        &token.get_address(),
        &wrong_permissioned.pubkey(),
        &account_owner.pubkey(),
        &[],
        1,
        decimals,
    )
    .unwrap();
    let error = token
        .process_ixs(&[ix_wrong], &[&account_owner, &wrong_permissioned])
        .await
        .unwrap_err();
    assert_eq!(
        error,
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::InvalidAccountData)
        )))
    );

    // Permissioned burn with the configured authority succeeds.
    let ix_ok = permissioned_burn_instruction::burn_checked(
        &spl_token_2022_interface::id(),
        &account,
        &token.get_address(),
        &authority.pubkey(),
        &account_owner.pubkey(),
        &[],
        1,
        decimals,
    )
    .unwrap();
    token
        .process_ixs(&[ix_ok], &[&account_owner, &authority])
        .await
        .unwrap();

    let account_after = token.get_account_info(&account).await.unwrap();
    assert_eq!(u64::from(account_after.base.amount), 1);
    let mint_after = token.get_mint_info().await.unwrap();
    assert_eq!(u64::from(mint_after.base.supply), 1);

    // Update permissioned burn authority and ensure new authority is enforced.
    token
        .set_authority(
            token.get_address(),
            &authority.pubkey(),
            Some(&new_authority.pubkey()),
            AuthorityType::PermissionedBurn,
            &[&authority],
        )
        .await
        .unwrap();

    // Old authority should no longer work.
    let ix_old = permissioned_burn_instruction::burn_checked(
        &spl_token_2022_interface::id(),
        &account,
        &token.get_address(),
        &authority.pubkey(),
        &account_owner.pubkey(),
        &[],
        1,
        decimals,
    )
    .unwrap();
    let err_old = token
        .process_ixs(&[ix_old], &[&account_owner, &authority])
        .await
        .unwrap_err();
    assert_eq!(
        err_old,
        TokenClientError::Client(Box::new(TransportError::TransactionError(
            TransactionError::InstructionError(0, InstructionError::InvalidAccountData)
        )))
    );

    // New authority should succeed.
    let ix_new = permissioned_burn_instruction::burn_checked(
        &spl_token_2022_interface::id(),
        &account,
        &token.get_address(),
        &new_authority.pubkey(),
        &account_owner.pubkey(),
        &[],
        1,
        decimals,
    )
    .unwrap();
    token
        .process_ixs(&[ix_new], &[&account_owner, &new_authority])
        .await
        .unwrap();
}
