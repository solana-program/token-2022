use {
    super::*,
    assert_cmd::cargo::cargo_bin_cmd,
    base64::{engine::general_purpose::STANDARD, Engine},
    serde_json::Value,
    std::{io::ErrorKind, net::TcpListener, process::Output, time::Duration},
};

fn args(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

struct Fixture {
    config: Config<'static>,
    payer: Keypair,
    owner: Keypair,
    payer_file: NamedTempFile,
    owner_file: NamedTempFile,
    cli_config_file: NamedTempFile,
    offline_rpc: TcpListener,
    mint: Pubkey,
    watched: Vec<Pubkey>,
}

impl Fixture {
    async fn new(test_validator: &TestValidator, payer: &Keypair, options: &[&str]) -> Self {
        let fixture_payer = Keypair::new();
        let owner = Keypair::new();
        let rpc = test_validator.get_async_rpc_client();
        let funding = Transaction::new_signed_with_payer(
            &[
                system_instruction::transfer(
                    &payer.pubkey(),
                    &fixture_payer.pubkey(),
                    10_000_000_000,
                ),
                system_instruction::transfer(&payer.pubkey(), &owner.pubkey(), 1_000_000_000),
            ],
            Some(&payer.pubkey()),
            &[payer],
            rpc.get_latest_blockhash().await.unwrap(),
        );
        rpc.send_and_confirm_transaction(&funding).await.unwrap();
        let config = test_config_with_default_signer(
            test_validator,
            &owner,
            &spl_token_2022_interface::id(),
        );
        let payer_file = NamedTempFile::new().unwrap();
        let owner_file = NamedTempFile::new().unwrap();
        write_keypair_file(&fixture_payer, &payer_file).unwrap();
        write_keypair_file(&owner, &owner_file).unwrap();
        let cli_config_file = NamedTempFile::new().unwrap();
        let offline_rpc = TcpListener::bind("127.0.0.1:0").unwrap();
        offline_rpc.set_nonblocking(true).unwrap();
        solana_cli_config::Config {
            keypair_path: payer_file.path().to_str().unwrap().to_string(),
            json_rpc_url: format!("http://{}", offline_rpc.local_addr().unwrap()),
            commitment: config.rpc_client.commitment().commitment.to_string(),
            ..solana_cli_config::Config::default()
        }
        .save(cli_config_file.path().to_str().unwrap())
        .unwrap();
        let mint = Keypair::new();
        let mint_file = NamedTempFile::new().unwrap();
        write_keypair_file(&mint, &mint_file).unwrap();
        let mut create = args(&[
            "spl-token",
            "create-token",
            mint_file.path().to_str().unwrap(),
            "--decimals",
            "0",
        ]);
        create.extend(args(options));
        process_test_command(&config, &owner, create).await.unwrap();
        Self {
            watched: vec![fixture_payer.pubkey(), owner.pubkey(), mint.pubkey()],
            config,
            payer: fixture_payer,
            owner,
            payer_file,
            owner_file,
            cli_config_file,
            offline_rpc,
            mint: mint.pubkey(),
        }
    }

    async fn online(&self, command: &[&str]) {
        process_test_command(
            &self.config,
            &self.owner,
            args(&["spl-token"]).into_iter().chain(args(command)),
        )
        .await
        .unwrap();
    }

    async fn account(&mut self, associated: bool) -> Pubkey {
        let account = if associated {
            create_associated_account(&self.config, &self.owner, &self.mint, &self.owner.pubkey())
                .await
        } else {
            create_auxiliary_account(&self.config, &self.owner, self.mint).await
        };
        self.watched.push(account);
        self.online(&[
            "configure-confidential-transfer-account",
            "--address",
            &account.to_string(),
        ])
        .await;
        account
    }

    async fn extension(&self, account: Pubkey) -> ConfidentialTransferAccount {
        let account = self.config.rpc_client.get_account(&account).await.unwrap();
        *StateWithExtensionsOwned::<Account>::unpack(account.data)
            .unwrap()
            .get_extension::<ConfidentialTransferAccount>()
            .unwrap()
    }

    async fn mint_state(&self) -> StateWithExtensionsOwned<Mint> {
        let account = self
            .config
            .rpc_client
            .get_account(&self.mint)
            .await
            .unwrap();
        StateWithExtensionsOwned::<Mint>::unpack(account.data).unwrap()
    }

    fn binary(
        &self,
        command: &[String],
        hash: Hash,
        offline: bool,
        signatures: &[String],
        format: &str,
    ) -> assert_cmd::Command {
        let mut binary = cargo_bin_cmd!("spl-token");
        let mut command = command.to_vec();
        if !signatures.is_empty() {
            for argument in &mut command {
                if argument == self.owner_file.path().to_str().unwrap() {
                    *argument = self.owner.pubkey().to_string();
                }
            }
        }
        let rpc_url = if offline {
            format!("http://{}", self.offline_rpc.local_addr().unwrap())
        } else {
            self.config.rpc_client.url()
        };
        let fee_payer = if offline {
            self.payer.pubkey().to_string()
        } else {
            self.payer_file.path().to_str().unwrap().to_string()
        };
        binary
            .args(command)
            .args([
                "--config",
                self.cli_config_file.path().to_str().unwrap(),
                "--url",
                &rpc_url,
                "--program-2022",
                "--fee-payer",
                &fee_payer,
                "--blockhash",
                &hash.to_string(),
                "--output",
                format,
            ])
            .timeout(Duration::from_secs(60));
        if offline {
            binary.arg("--sign-only");
        }
        for signature in signatures {
            binary.args(["--signer", signature]);
        }
        binary
    }

    async fn output(
        &self,
        command: &[String],
        hash: Hash,
        signatures: &[String],
        format: &str,
    ) -> Output {
        let before = self
            .config
            .rpc_client
            .get_multiple_accounts(&self.watched)
            .await
            .unwrap();
        let output = self
            .binary(command, hash, true, signatures, format)
            .arg("--dump-transaction-message")
            .output()
            .unwrap();
        let after = self
            .config
            .rpc_client
            .get_multiple_accounts(&self.watched)
            .await
            .unwrap();
        assert_eq!(before, after, "offline invocation changed account state");
        self.assert_no_rpc();
        output
    }

    fn assert_no_rpc(&self) {
        assert!(
            matches!(self.offline_rpc.accept(), Err(error) if error.kind() == ErrorKind::WouldBlock),
            "sign-only invocation contacted the RPC endpoint"
        );
    }

    async fn complete(&mut self, command: &[String]) {
        let hash = self.config.rpc_client.get_latest_blockhash().await.unwrap();
        let _ = self.sign(command, hash).await;

        // Online CLI construction fixes the supplied hash only with a durable nonce.
        let nonce = create_nonce(&self.config, &self.owner).await;
        self.watched.push(nonce);
        let nonce_before = self.config.rpc_client.get_account(&nonce).await.unwrap();
        let nonce_hash = Hash::new_from_array(nonce_before.data[40..72].try_into().unwrap());
        let mut nonce_command = command.to_vec();
        nonce_command.extend(args(&[
            "--nonce",
            &nonce.to_string(),
            "--nonce-authority",
            self.owner_file.path().to_str().unwrap(),
        ]));
        self.complete_at(&nonce_command, nonce_hash).await;
        assert_ne!(
            self.config
                .rpc_client
                .get_account(&nonce)
                .await
                .unwrap()
                .data,
            nonce_before.data,
            "CLI submission did not advance the nonce"
        );
    }

    async fn sign(&self, command: &[String], hash: Hash) -> Vec<String> {
        let parse = |output: Output| {
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            serde_json::from_slice::<Value>(&output.stdout).unwrap()
        };
        let first = parse(self.output(command, hash, &[], "json-compact").await);
        assert_eq!(first["blockhash"], hash.to_string());
        assert!(first["absent"]
            .as_array()
            .unwrap()
            .contains(&Value::String(self.payer.pubkey().to_string())));
        let second = parse(self.output(command, hash, &[], "json").await);
        assert_eq!(
            first, second,
            "same command did not reproduce the signed message"
        );
        let signatures: Vec<String> = first.get("signers").map_or_else(Vec::new, |signers| {
            signers
                .as_array()
                .unwrap()
                .iter()
                .map(|s| s.as_str().unwrap().to_string())
                .collect()
        });
        let replay = parse(
            self.output(command, hash, &signatures, "json-compact")
                .await,
        );
        assert_eq!(
            first, replay,
            "--signer replay changed the message or signatures"
        );
        let normal = parse(
            self.binary(command, hash, true, &signatures, "json-compact")
                .output()
                .unwrap(),
        );
        assert!(normal.get("message").is_none());
        assert_eq!(normal["signers"], first["signers"]);
        assert_eq!(normal["absent"], first["absent"]);
        self.assert_no_rpc();
        signatures
    }

    async fn complete_at(&self, command: &[String], hash: Hash) {
        let signatures = self.sign(command, hash).await;
        let submitted = self
            .binary(command, hash, false, &signatures, "json-compact")
            .output()
            .unwrap();
        assert!(
            submitted.status.success(),
            "CLI submission failed for {command:?}: {}",
            String::from_utf8_lossy(&submitted.stderr)
        );
        serde_json::from_slice::<Value>(&submitted.stdout).unwrap();
    }

    async fn error(&self, command: &[String], expected: &str) {
        let hash = self.config.rpc_client.get_latest_blockhash().await.unwrap();
        let output = self.output(command, hash, &[], "json-compact").await;
        Self::assert_error(output, expected);
    }

    async fn online_error(&self, command: &[String], hash: Hash, expected: &str) {
        let before = self
            .config
            .rpc_client
            .get_multiple_accounts(&self.watched)
            .await
            .unwrap();
        let output = self
            .binary(command, hash, false, &[], "json-compact")
            .output()
            .unwrap();
        let after = self
            .config
            .rpc_client
            .get_multiple_accounts(&self.watched)
            .await
            .unwrap();
        assert_eq!(before, after, "rejected command submitted a transaction");
        Self::assert_error(output, expected);
    }

    fn assert_error(output: Output, expected: &str) {
        assert!(
            !output.status.success(),
            "expected rejection, got {}",
            String::from_utf8_lossy(&output.stdout)
        );
        let error = String::from_utf8_lossy(&output.stderr);
        assert!(error.contains(expected), "expected {expected}, got {error}");
        assert!(!error.contains("panicked"), "{error}");
    }
}

pub async fn offline_confidential_controls(test_validator: &TestValidator, payer: &Keypair) {
    let mut fixture = Fixture::new(
        test_validator,
        payer,
        &["--enable-confidential-transfers", "manual"],
    )
    .await;
    let account = fixture.account(true).await;
    assert!(!bool::from(fixture.extension(account).await.approved));
    let mut approve = args(&[
        "approve-confidential-transfer-account",
        "--address",
        &account.to_string(),
        "--confidential-transfer-authority",
        fixture.owner_file.path().to_str().unwrap(),
    ]);
    fixture.error(&approve, "--mint-address").await;
    approve.extend(args(&["--mint-address", &fixture.mint.to_string()]));
    let hash = fixture
        .config
        .rpc_client
        .get_latest_blockhash()
        .await
        .unwrap();
    let mut wrong_mint = approve.clone();
    *wrong_mint.last_mut().unwrap() = Pubkey::new_unique().to_string();
    fixture
        .online_error(&wrong_mint, hash, "does not contain")
        .await;
    fixture.complete(&approve).await;
    assert!(bool::from(fixture.extension(account).await.approved));
    fixture
        .online_error(&wrong_mint, hash, "does not contain")
        .await;

    for (index, (command, confidential, enabled)) in [
        ("disable-confidential-credits", true, false),
        ("enable-confidential-credits", true, true),
        ("disable-non-confidential-credits", false, false),
        ("enable-non-confidential-credits", false, true),
    ]
    .into_iter()
    .enumerate()
    {
        let wrong_mint = args(&[
            command,
            "--address",
            &account.to_string(),
            "--owner",
            fixture.owner_file.path().to_str().unwrap(),
            "--mint-address",
            &Pubkey::new_unique().to_string(),
        ]);
        fixture
            .online_error(&wrong_mint, hash, "does not contain")
            .await;
        let mut command = if index % 2 == 0 {
            args(&[command, &fixture.mint.to_string()])
        } else {
            args(&[command, "--address", &account.to_string()])
        };
        command.extend(args(&[
            "--owner",
            fixture.owner_file.path().to_str().unwrap(),
        ]));
        if index % 2 != 0 {
            fixture.error(&command, "--mint-address").await;
            command.extend(args(&["--mint-address", &fixture.mint.to_string()]));
        }
        fixture.complete(&command).await;
        let extension = fixture.extension(account).await;
        assert_eq!(
            bool::from(if confidential {
                extension.allow_confidential_credits
            } else {
                extension.allow_non_confidential_credits
            }),
            enabled
        );
        // A mismatched mint must also fail when the credit setting is already applied.
        fixture
            .online_error(&wrong_mint, hash, "does not contain")
            .await;
    }

    let settings = args(&[
        "update-confidential-transfer-settings",
        &fixture.mint.to_string(),
        "--confidential-transfer-authority",
        fixture.owner_file.path().to_str().unwrap(),
        "--approve-policy",
        "auto",
        "--auditor-pubkey",
        "none",
    ]);
    fixture
        .error(&settings[..settings.len() - 2], "--auditor-pubkey")
        .await;
    let mut no_policy = settings.clone();
    no_policy.drain(no_policy.len() - 4..no_policy.len() - 2);
    fixture.error(&no_policy, "--approve-policy").await;
    fixture.complete(&settings).await;
    assert!(bool::from(
        fixture
            .mint_state()
            .await
            .get_extension::<ConfidentialTransferMint>()
            .unwrap()
            .auto_approve_new_accounts
    ));

    fixture
        .online(&[
            "mint",
            &fixture.mint.to_string(),
            "100",
            &account.to_string(),
        ])
        .await;
    let deposit = args(&[
        "deposit-confidential-tokens",
        &fixture.mint.to_string(),
        "10",
        "--address",
        &account.to_string(),
        "--owner",
        fixture.owner_file.path().to_str().unwrap(),
        "--mint-decimals",
        "0",
    ]);
    fixture
        .error(&deposit[..deposit.len() - 2], "mint-decimals")
        .await;
    let mut all = deposit.clone();
    all[2] = "ALL".to_string();
    fixture.error(&all, "explicit amount").await;
    fixture.complete(&deposit).await;
    assert_eq!(
        decrypted_confidential_balances(&fixture.config, &fixture.owner, &account).await,
        (10.0, 0.0)
    );

    let nonce = create_nonce(&fixture.config, &fixture.owner).await;
    fixture.watched.push(nonce);
    let nonce_account = fixture.config.rpc_client.get_account(&nonce).await.unwrap();
    let hash = Hash::new_from_array(nonce_account.data[40..72].try_into().unwrap());
    let nonce_deposit = args(&[
        "deposit-confidential-tokens",
        &fixture.mint.to_string(),
        "1",
        "--mint-decimals",
        "0",
        "--owner",
        fixture.owner_file.path().to_str().unwrap(),
        "--nonce",
        &nonce.to_string(),
        "--nonce-authority",
        fixture.owner_file.path().to_str().unwrap(),
    ]);
    fixture.complete_at(&nonce_deposit, hash).await;
    assert_ne!(
        fixture
            .config
            .rpc_client
            .get_account(&nonce)
            .await
            .unwrap()
            .data,
        nonce_account.data
    );
    assert_eq!(
        decrypted_confidential_balances(&fixture.config, &fixture.owner, &account).await,
        (11.0, 0.0)
    );
}

pub async fn offline_confidential_fee_controls(test_validator: &TestValidator, payer: &Keypair) {
    let mut fixture = Fixture::new(
        test_validator,
        payer,
        &[
            "--enable-confidential-transfers",
            "auto",
            "--transfer-fee",
            "1000",
            "100",
        ],
    )
    .await;
    let source = fixture.account(true).await;
    let destination = fixture.account(false).await;
    for (command, enabled) in [
        ("disable-confidential-fee-harvesting", false),
        ("enable-confidential-fee-harvesting", true),
    ] {
        fixture
            .complete(&args(&[
                command,
                &fixture.mint.to_string(),
                "--owner",
                fixture.owner_file.path().to_str().unwrap(),
            ]))
            .await;
        assert_eq!(
            bool::from(
                fixture
                    .mint_state()
                    .await
                    .get_extension::<ConfidentialTransferFeeConfig>()
                    .unwrap()
                    .harvest_to_mint_enabled
            ),
            enabled
        );
    }
    fixture
        .online(&[
            "mint",
            &fixture.mint.to_string(),
            "100",
            &source.to_string(),
        ])
        .await;
    fixture
        .online(&[
            "deposit-confidential-tokens",
            &fixture.mint.to_string(),
            "100",
        ])
        .await;
    fixture
        .online(&["apply-pending-balance", &fixture.mint.to_string()])
        .await;
    fixture
        .online(&[
            "transfer",
            &fixture.mint.to_string(),
            "10",
            &destination.to_string(),
            "--confidential",
            "--expected-fee",
            "1",
        ])
        .await;
    let destination_state = fixture
        .config
        .rpc_client
        .get_account(&destination)
        .await
        .unwrap();
    assert_ne!(
        StateWithExtensionsOwned::<Account>::unpack(destination_state.data)
            .unwrap()
            .get_extension::<ConfidentialTransferFeeAmount>()
            .unwrap()
            .withheld_amount,
        PodElGamalCiphertext::default()
    );

    let mut sources = vec![source, destination];
    for _ in sources.len()..26 {
        sources.push(fixture.account(false).await);
    }
    let mut oversized = args(&[
        "harvest-withheld-confidential-tokens",
        &fixture.mint.to_string(),
    ]);
    oversized.extend(sources.iter().map(ToString::to_string));
    fixture
        .error(&oversized, "25 distinct source accounts")
        .await;
    let hash = fixture
        .config
        .rpc_client
        .get_latest_blockhash()
        .await
        .unwrap();
    let boundary = fixture
        .output(&oversized[..oversized.len() - 1], hash, &[], "json-compact")
        .await;
    assert!(
        boundary.status.success(),
        "{}",
        String::from_utf8_lossy(&boundary.stderr)
    );
    // A distinct nonce authority and both budget instructions need two source slots.
    let nonce = create_nonce(&fixture.config, &fixture.owner).await;
    fixture.watched.push(nonce);
    let nonce_account = fixture.config.rpc_client.get_account(&nonce).await.unwrap();
    let nonce_hash = Hash::new_from_array(nonce_account.data[40..72].try_into().unwrap());
    let mut nonce_harvest = args(&[
        "harvest-withheld-confidential-tokens",
        &fixture.mint.to_string(),
    ]);
    nonce_harvest.extend(sources[..23].iter().map(ToString::to_string));
    nonce_harvest.extend(args(&[
        "--nonce",
        &nonce.to_string(),
        "--nonce-authority",
        fixture.owner_file.path().to_str().unwrap(),
        "--with-compute-unit-price",
        "1000",
        "--with-compute-unit-limit",
        "200000",
    ]));
    let boundary = fixture
        .output(&nonce_harvest, nonce_hash, &[], "json-compact")
        .await;
    assert!(
        boundary.status.success(),
        "{}",
        String::from_utf8_lossy(&boundary.stderr)
    );
    let value: Value = serde_json::from_slice(&boundary.stdout).unwrap();
    let message = STANDARD.decode(value["message"].as_str().unwrap()).unwrap();
    assert_eq!(
        message[0], 2,
        "payer and nonce authority must be distinct signers"
    );
    // With two signatures, the compact signature count occupies one byte.
    let transaction_size = 1 + 2 * 64 + message.len();
    assert!(
        transaction_size <= 1232,
        "transaction exceeds Solana's 1232-byte packet limit: {transaction_size}"
    );
    for count in [24, 25, 26] {
        let mut unsupported = nonce_harvest.clone();
        unsupported.splice(2..2, sources[23..count].iter().map(ToString::to_string));
        fixture
            .error(&unsupported, "23 distinct source accounts")
            .await;
        fixture
            .online_error(&unsupported, nonce_hash, "23 distinct source accounts")
            .await;
    }

    let mut harvest = args(&[
        "harvest-withheld-confidential-tokens",
        &fixture.mint.to_string(),
        &source.to_string(),
    ]);
    harvest.extend((0..26).map(|_| destination.to_string()));
    fixture.complete(&harvest).await;
    let destination_state = fixture
        .config
        .rpc_client
        .get_account(&destination)
        .await
        .unwrap();
    assert_eq!(
        StateWithExtensionsOwned::<Account>::unpack(destination_state.data)
            .unwrap()
            .get_extension::<ConfidentialTransferFeeAmount>()
            .unwrap()
            .withheld_amount,
        PodElGamalCiphertext::default()
    );
    assert_ne!(
        fixture
            .mint_state()
            .await
            .get_extension::<ConfidentialTransferFeeConfig>()
            .unwrap()
            .withheld_amount,
        PodElGamalCiphertext::default()
    );

    fixture.complete_at(&nonce_harvest, nonce_hash).await;
    assert_ne!(
        fixture
            .config
            .rpc_client
            .get_account(&nonce)
            .await
            .unwrap()
            .data,
        nonce_account.data,
        "boundary harvest did not advance the nonce"
    );
    for count in [25, 26] {
        let command = &oversized[..count + 2];
        let output = fixture
            .binary(command, hash, false, &[], "json-compact")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "online harvest of {count} sources failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let transactions = serde_json::Deserializer::from_slice(&output.stdout)
            .into_iter::<Value>()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(transactions.len(), count.div_ceil(25));
    }
}

pub async fn offline_confidential_apply_pending_burn(
    test_validator: &TestValidator,
    payer: &Keypair,
) {
    let mut fixture = Fixture::new(
        test_validator,
        payer,
        &[
            "--enable-confidential-transfers",
            "auto",
            "--enable-confidential-mint-burn",
        ],
    )
    .await;
    let account = fixture.account(true).await;
    fixture
        .online(&[
            "mint",
            &fixture.mint.to_string(),
            "100",
            &account.to_string(),
            "--confidential",
        ])
        .await;
    fixture
        .online(&["apply-pending-balance", &fixture.mint.to_string()])
        .await;
    fixture
        .online(&["burn", &account.to_string(), "20", "--confidential"])
        .await;
    assert_ne!(
        fixture
            .mint_state()
            .await
            .get_extension::<ConfidentialMintBurn>()
            .unwrap()
            .pending_burn,
        PodElGamalCiphertext::default()
    );
    fixture
        .complete(&args(&[
            "apply-pending-burn",
            &fixture.mint.to_string(),
            "--owner",
            fixture.owner_file.path().to_str().unwrap(),
        ]))
        .await;
    let state = fixture.mint_state().await;
    let supply = state.get_extension::<ConfidentialMintBurn>().unwrap();
    assert_eq!(supply.pending_burn, PodElGamalCiphertext::default());
    let (keypair, _) = derive_confidential_keys(&fixture.owner, b"").unwrap();
    let ciphertext: solana_zk_sdk::encryption::elgamal::ElGamalCiphertext =
        supply.confidential_supply.try_into().unwrap();
    assert_eq!(ciphertext.decrypt_u32(keypair.secret()), Some(80));
}
