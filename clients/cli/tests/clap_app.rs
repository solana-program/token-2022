use {
    clap::ErrorKind,
    solana_clap_v3_utils::input_parsers::Amount,
    solana_pubkey::Pubkey,
    spl_token_cli::clap_app::{app, minimum_signers_help_string, multisig_member_help_string},
};

#[test]
fn configure_with_registry_arguments() {
    let minimum_signers_help = minimum_signers_help_string();
    let multisig_member_help = multisig_member_help_string();
    let app = app("9", &minimum_signers_help, &multisig_member_help);
    let address = "11111111111111111111111111111111";
    let args = [
        "spl-token",
        "configure-confidential-transfer-account",
        "--address",
        address,
        "--elgamal-registry",
        address,
    ];
    let matches = app.clone().try_get_matches_from(args).unwrap();
    assert_eq!(
        matches.subcommand().unwrap().1.value_of("elgamal_registry"),
        Some(address),
    );

    for (option, value) in [
        ("--maximum-pending-balance-credit-counter", "10"),
        ("--multisig-signer", address),
    ] {
        let error = app
            .clone()
            .try_get_matches_from(args.into_iter().chain([option, value]))
            .unwrap_err();
        assert_eq!(error.kind(), ErrorKind::ArgumentConflict);
    }
}

#[test]
fn create_token_rejects_unparsable_extension_values() {
    let minimum_signers_help = minimum_signers_help_string();
    let multisig_member_help = multisig_member_help_string();
    let app = app("9", &minimum_signers_help, &multisig_member_help);

    let matches = app
        .clone()
        .try_get_matches_from(["spl-token", "create-token", "--interest-rate", "500"])
        .unwrap();
    assert_eq!(
        matches
            .subcommand()
            .unwrap()
            .1
            .get_one::<i16>("interest_rate"),
        Some(&500),
    );

    let matches = app
        .clone()
        .try_get_matches_from(["spl-token", "create-token", "--ui-amount-multiplier", "1.5"])
        .unwrap();
    assert_eq!(
        matches
            .subcommand()
            .unwrap()
            .1
            .get_one::<f64>("ui_amount_multiplier"),
        Some(&1.5),
    );

    for (option, value) in [
        ("--interest-rate", "50000"),
        ("--ui-amount-multiplier", "1,5"),
    ] {
        let error = app
            .clone()
            .try_get_matches_from(["spl-token", "create-token", option, value])
            .unwrap_err();
        assert_eq!(error.kind(), ErrorKind::ValueValidation, "{option} {value}");
    }
}

#[test]
fn confidential_fee_amount_argument_validation() {
    let destination = Pubkey::new_unique().to_string();
    for amount in ["-1", "not-an-amount"] {
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
    let matches = app("9", "", "")
        .try_get_matches_from([
            "spl-token",
            "withdraw-withheld-tokens",
            &destination,
            "--include-mint",
            "--confidential",
            "--amount",
            "1.5",
        ])
        .unwrap();
    assert_eq!(
        matches.subcommand().unwrap().1.get_one::<Amount>("amount"),
        Some(&Amount::Decimal(1.5)),
    );
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
fn confidential_operation_keys_require_both_flags() {
    let minimum_signers_help = minimum_signers_help_string();
    let multisig_member_help = multisig_member_help_string();
    let app = app("9", &minimum_signers_help, &multisig_member_help);
    let mint = Pubkey::new_unique().to_string();
    let account = Pubkey::new_unique().to_string();

    for args in [
        vec![
            "spl-token",
            "transfer",
            &mint,
            "1",
            &account,
            "--confidential",
            "--elgamal-keypair",
            "elgamal.json",
        ],
        vec![
            "spl-token",
            "withdraw-confidential-tokens",
            &mint,
            "1",
            "--aes-key",
            "aes.bin",
        ],
        vec![
            "spl-token",
            "configure-confidential-transfer-account",
            &mint,
            "--elgamal-keypair",
            "elgamal.json",
        ],
    ] {
        let error = app.clone().try_get_matches_from(args).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::MissingRequiredArgument);
    }

    let matches = app
        .clone()
        .try_get_matches_from([
            "spl-token",
            "apply-pending-balance",
            &mint,
            "--elgamal-keypair",
            "elgamal.json",
            "--aes-key",
            "aes.bin",
        ])
        .unwrap();
    assert_eq!(
        matches.subcommand().unwrap().1.value_of("elgamal_keypair"),
        Some("elgamal.json"),
    );
    assert_eq!(
        matches.subcommand().unwrap().1.value_of("aes_key"),
        Some("aes.bin"),
    );

    // The withdraw withheld authority only has an ElGamal key, and the fee
    // recipient only needs its AES key.
    let matches = app
        .clone()
        .try_get_matches_from([
            "spl-token",
            "withdraw-withheld-tokens",
            &account,
            "--include-mint",
            "--confidential",
            "--withdraw-withheld-authority-elgamal-keypair",
            "elgamal.json",
            "--destination-aes-key",
            "aes.bin",
        ])
        .unwrap();
    let sub_matches = matches.subcommand().unwrap().1;
    assert_eq!(
        sub_matches.value_of("withdraw_withheld_authority_elgamal_keypair"),
        Some("elgamal.json"),
    );
    assert_eq!(sub_matches.value_of("destination_aes_key"), Some("aes.bin"));
    let error = app
        .try_get_matches_from([
            "spl-token",
            "withdraw-withheld-tokens",
            &account,
            "--include-mint",
            "--confidential",
            "--elgamal-keypair",
            "elgamal.json",
        ])
        .unwrap_err();
    assert_eq!(error.kind(), ErrorKind::UnknownArgument);
}
