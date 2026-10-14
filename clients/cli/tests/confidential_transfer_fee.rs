use {
    base64::{prelude::BASE64_STANDARD, Engine},
    serde_json::{json, Value},
    solana_cli_output::OutputFormat,
    solana_client::{nonblocking::rpc_client::RpcClient, rpc_request::RpcRequest},
    solana_sdk::{pubkey::Pubkey, signature::Keypair, signer::Signer},
    solana_zk_sdk::encryption::derivation::derive_confidential_keys,
    spl_token_2022_interface::{
        extension::{
            confidential_transfer::ConfidentialTransferAccount,
            confidential_transfer_fee::{
                ConfidentialTransferFeeAmount, ConfidentialTransferFeeConfig,
            },
            transfer_fee::{TransferFeeAmount, TransferFeeConfig},
            BaseStateWithExtensionsMut, ExtensionType, StateWithExtensionsMut,
        },
        state::{Account, AccountState, Mint},
    },
    spl_token_cli::{
        clap_app::{app, CommandName},
        command::{process_command, CommandResult},
        config::Config,
    },
    spl_token_client::{
        client::{ProgramRpcClient, ProgramRpcClientSendTransaction},
        token::ComputeUnitLimit,
    },
    std::sync::Arc,
};

fn account_response(data: Vec<u8>) -> Value {
    json!({
        "context": { "slot": 1 },
        "value": {
            "lamports": 1_000_000,
            "owner": spl_token_2022_interface::id().to_string(),
            "data": [BASE64_STANDARD.encode(&data), "base64"],
            "executable": false,
            "rentEpoch": 0,
            "space": data.len(),
        }
    })
}

async fn withdraw(
    amount: u64,
    known_amount: Option<u64>,
    current_balance: u64,
    from_mint: bool,
) -> CommandResult {
    let signer = Arc::new(Keypair::new());
    let (elgamal_keypair, aes_key) = derive_confidential_keys(signer.as_ref(), b"").unwrap();
    let mint = Pubkey::new_unique();
    let destination = Pubkey::new_unique();
    let sources = [Pubkey::new_unique(), Pubkey::new_unique()];

    let mut destination_data = vec![
        0;
        ExtensionType::try_calculate_account_len::<Account>(&[
            ExtensionType::TransferFeeAmount,
            ExtensionType::ConfidentialTransferAccount,
        ])
        .unwrap()
    ];
    let mut state =
        StateWithExtensionsMut::<Account>::unpack_uninitialized(&mut destination_data).unwrap();
    state.init_extension::<TransferFeeAmount>(true).unwrap();
    let confidential = state
        .init_extension::<ConfidentialTransferAccount>(true)
        .unwrap();
    confidential.elgamal_pubkey = (*elgamal_keypair.pubkey()).into();
    confidential.available_balance = elgamal_keypair.pubkey().encrypt(current_balance).into();
    confidential.decryptable_available_balance = aes_key.encrypt(current_balance).into();
    state.base.mint = mint;
    state.base.owner = signer.pubkey();
    state.base.state = AccountState::Initialized;
    state.pack_base();
    state.init_account_type().unwrap();

    let mut mint_data = vec![
        0;
        ExtensionType::try_calculate_account_len::<Mint>(&[
            ExtensionType::TransferFeeConfig,
            ExtensionType::ConfidentialTransferFeeConfig,
        ])
        .unwrap()
    ];
    let mut state = StateWithExtensionsMut::<Mint>::unpack_uninitialized(&mut mint_data).unwrap();
    state
        .init_extension::<TransferFeeConfig>(true)
        .unwrap()
        .withdraw_withheld_authority = signer.pubkey().into();
    let fee_config = state
        .init_extension::<ConfidentialTransferFeeConfig>(true)
        .unwrap();
    fee_config.withdraw_withheld_authority_elgamal_pubkey = (*elgamal_keypair.pubkey()).into();
    fee_config.withheld_amount = elgamal_keypair.pubkey().encrypt(amount).into();
    state.base.is_initialized = true;
    state.base.decimals = 9;
    state.pack_base();
    state.init_account_type().unwrap();

    let mut responses = vec![
        (
            RpcRequest::GetAccountInfo,
            account_response(destination_data.clone()),
        ),
        (RpcRequest::GetAccountInfo, account_response(mint_data)),
    ];
    for source_amount in [amount / 2, amount - amount / 2] {
        let mut source_data = vec![
            0;
            ExtensionType::try_calculate_account_len::<Account>(&[
                ExtensionType::ConfidentialTransferAccount,
                ExtensionType::ConfidentialTransferFeeAmount,
            ])
            .unwrap()
        ];
        let mut state =
            StateWithExtensionsMut::<Account>::unpack_uninitialized(&mut source_data).unwrap();
        let confidential = state
            .init_extension::<ConfidentialTransferAccount>(true)
            .unwrap();
        confidential.elgamal_pubkey = (*elgamal_keypair.pubkey()).into();
        confidential.available_balance = elgamal_keypair.pubkey().encrypt(current_balance).into();
        confidential.decryptable_available_balance = aes_key.encrypt(current_balance).into();
        state
            .init_extension::<ConfidentialTransferFeeAmount>(true)
            .unwrap()
            .withheld_amount = elgamal_keypair.pubkey().encrypt(source_amount).into();
        state.base.mint = mint;
        state.base.owner = signer.pubkey();
        state.base.state = AccountState::Initialized;
        state.pack_base();
        state.init_account_type().unwrap();
        responses.push((RpcRequest::GetAccountInfo, account_response(source_data)));
    }
    responses.push((
        RpcRequest::GetAccountInfo,
        account_response(destination_data),
    ));
    let rpc_client = Arc::new(RpcClient::new_mock_with_mocks_map(
        "succeeds",
        responses.into_iter().collect(),
    ));
    let config = Config {
        default_signer: Some(signer.clone()),
        rpc_client: rpc_client.clone(),
        program_client: Arc::new(ProgramRpcClient::new(
            rpc_client,
            ProgramRpcClientSendTransaction,
        )),
        websocket_url: String::new(),
        output_format: OutputFormat::JsonCompact,
        fee_payer: Some(signer.clone()),
        nonce_account: None,
        nonce_authority: None,
        nonce_blockhash: None,
        sign_only: false,
        dump_transaction_message: false,
        multisigner_pubkeys: vec![],
        program_id: spl_token_2022_interface::id(),
        restrict_to_program_id: true,
        compute_unit_price: None,
        compute_unit_limit: ComputeUnitLimit::Static(200_000),
    };
    let mut arguments = vec![
        "spl-token".to_string(),
        "withdraw-withheld-tokens".to_string(),
        destination.to_string(),
        "--confidential".to_string(),
    ];
    if from_mint {
        arguments.push("--include-mint".to_string());
    } else {
        arguments.extend(sources.iter().map(ToString::to_string));
    }
    if let Some(known_amount) = known_amount {
        arguments.extend(["--amount".to_string(), known_amount.to_string()]);
    }
    let matches = app("9", "", "").try_get_matches_from(arguments).unwrap();
    process_command(
        &CommandName::WithdrawWithheldTokens,
        matches.subcommand().unwrap().1,
        &config,
        None,
        vec![signer],
    )
    .await
}

#[tokio::test]
async fn confidential_fee_withdrawal_forwards_optional_amount() {
    for from_mint in [true, false] {
        for (amount, known_amount) in [
            (55, None),
            (55, Some(55)),
            (u64::from(u32::MAX) + 1, Some(u64::from(u32::MAX) + 1)),
        ] {
            let result = withdraw(amount, known_amount, 17, from_mint).await;
            assert!(
                result.is_ok(),
                "mint={from_mint}, known={known_amount:?}: {result:?}"
            );
        }
    }
}

#[tokio::test]
async fn confidential_fee_withdrawal_rejects_mismatch_and_overflow() {
    for from_mint in [true, false] {
        let error = withdraw(55, Some(54), 17, from_mint).await.unwrap_err();
        assert_eq!(error.to_string(), "proof generation");
        let error = withdraw(0, Some(1), 17, from_mint).await.unwrap_err();
        assert_eq!(error.to_string(), "proof generation");
        let error = withdraw(55, Some(55), u64::MAX, from_mint)
            .await
            .unwrap_err();
        assert_eq!(error.to_string(), "Confidential available balance overflow");
    }
}

#[test]
fn confidential_fee_amount_argument_validation() {
    let destination = Pubkey::new_unique().to_string();
    for amount in ["-1", "18446744073709551616", "1.5"] {
        assert!(app("9", "", "")
            .try_get_matches_from([
                "spl-token",
                "withdraw-withheld-tokens",
                &destination,
                "--include-mint",
                "--confidential",
                "--amount",
                amount,
            ])
            .is_err());
    }
    assert!(app("9", "", "")
        .try_get_matches_from([
            "spl-token",
            "withdraw-withheld-tokens",
            &destination,
            "--include-mint",
            "--amount",
            "55",
        ])
        .is_err());
}

#[test]
fn confidential_fee_amount_help_uses_base_units() {
    let mut command = app("9", "", "");
    let mut help = Vec::new();
    command
        .find_subcommand_mut("withdraw-withheld-tokens")
        .unwrap()
        .write_long_help(&mut help)
        .unwrap();
    let help = String::from_utf8(help).unwrap();
    let help = help.split_whitespace().collect::<Vec<_>>().join(" ");
    assert!(help.contains("base units (smallest token units)"));
    assert!(help.contains("no decimal scaling"));
}
