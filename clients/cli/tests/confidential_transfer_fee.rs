use {solana_sdk::pubkey::Pubkey, spl_token_cli::clap_app::app};

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
