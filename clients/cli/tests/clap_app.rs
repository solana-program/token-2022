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
