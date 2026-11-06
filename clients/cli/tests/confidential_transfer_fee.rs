use {
    solana_clap_v3_utils::input_parsers::Amount, solana_sdk::pubkey::Pubkey,
    spl_token_cli::clap_app::app,
};

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
