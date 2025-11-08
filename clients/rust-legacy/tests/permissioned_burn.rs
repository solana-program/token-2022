mod program_test;
use {
    program_test::{TestContext, TokenContext},
    solana_program_error::ProgramError,
    solana_program_test::tokio,
    solana_sdk::{
        instruction::InstructionError, pubkey::Pubkey, signature::Signer, signer::keypair::Keypair,
        transaction::TransactionError, transport::TransportError,
    },
    spl_token_2022_interface::extension::BaseStateWithExtensions,
    spl_token_2022_interface::{
        error::TokenError, extension::permissioned_burn::PermissionedBurnConfig,
    },
    spl_token_client::token::{ExtensionInitializationParams, TokenError as TokenClientError},
};

#[tokio::test]
async fn success_initialize() {
    let authority = Pubkey::new_unique();
    let mut context = TestContext::new().await;
    context
        .init_token_with_mint(vec![
            ExtensionInitializationParams::PermissionedBurnConfig { authority },
        ])
        .await
        .unwrap();
    let TokenContext {
        token,
        mint_authority,
        alice,
        ..
    } = context.token_context.unwrap();

    let state = token.get_mint_info().await.unwrap();
    let extension = state.get_extension::<PermissionedBurnConfig>().unwrap();
    assert_eq!(Option::<Pubkey>::from(extension.authority), Some(authority));

    // mint a token
    let amount = 10;
    token
        .mint_to(
            &alice.pubkey(),
            &mint_authority.pubkey(),
            amount,
            &[&mint_authority],
        )
        .await
        .unwrap();

    // regular burn fails
    let error = token
        .burn(&alice.pubkey(), &alice.pubkey(), 1, &[&alice])
        .await
        .unwrap_err();
    // assert_eq!(
    //     error,
    //     TokenClientError::Client(Box::new(TransportError::TransactionError(
    //         TransactionError::InstructionError(
    //             0,
    //             InstructionError::Custom(ProgramError::MissingRequiredSignature as u32)
    //         )
    //     )))
    // );

    // // checked is ok
    // token
    //     .burn(&alice_account, &alice.pubkey(), 1, &[&alice])
    //     .await
    //     .unwrap();

    // // burn too much is not ok
    // let error = token
    //     .burn(&alice_account, &alice.pubkey(), amount, &[&alice])
    //     .await
    //     .unwrap_err();
    // assert_eq!(
    //     error,
    //     TokenClientError::Client(Box::new(TransportError::TransactionError(
    //         TransactionError::InstructionError(
    //             0,
    //             InstructionError::Custom(TokenError::InsufficientFunds as u32)
    //         )
    //     )))
    // );

    // // wrong signer
    // let error = token
    //     .burn(&alice_account, &bob.pubkey(), 1, &[&bob])
    //     .await
    //     .unwrap_err();
    // assert_eq!(
    //     error,
    //     TokenClientError::Client(Box::new(TransportError::TransactionError(
    //         TransactionError::InstructionError(
    //             0,
    //             InstructionError::Custom(TokenError::OwnerMismatch as u32)
    //         )
    //     )))
    // );
}
