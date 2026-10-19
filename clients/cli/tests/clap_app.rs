use {
    clap::ErrorKind,
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
