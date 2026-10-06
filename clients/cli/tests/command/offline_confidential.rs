use {
    super::*,
    assert_cmd::cargo::cargo_bin_cmd,
    base64::{engine::general_purpose::STANDARD, Engine},
    serde_json::Value,
    solana_sdk::{message::Message, signature::Signature},
    std::{collections::BTreeSet, process::Output, time::Duration},
};

fn args(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

struct Fixture {
    config: Config<'static>,
    payer: Keypair,
    owner: Keypair,
    owner_file: NamedTempFile,
    cli_config_file: NamedTempFile,
    mint: Pubkey,
    watched: Vec<Pubkey>,
    proof_lamports: u64,
}

impl Fixture {
    async fn new(test_validator: &TestValidator, payer: &Keypair, mint_options: &[&str]) -> Self {
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
        let owner_file = NamedTempFile::new().unwrap();
        write_keypair_file(&owner, &owner_file).unwrap();
        let cli_config_file = NamedTempFile::new().unwrap();
        let cli_config = solana_cli_config::Config {
            keypair_path: owner_file.path().to_str().unwrap().to_string(),
            json_rpc_url: "http://127.0.0.1:1".to_string(),
            ..solana_cli_config::Config::default()
        };
        cli_config
            .save(cli_config_file.path().to_str().unwrap())
            .unwrap();
        let mint = Keypair::new();
        let mint_file = NamedTempFile::new().unwrap();
        write_keypair_file(&mint, &mint_file).unwrap();
        let mut create_args = args(&[
            "spl-token",
            "create-token",
            mint_file.path().to_str().unwrap(),
            "--decimals",
            "0",
        ]);
        create_args.extend(args(mint_options));
        process_test_command(&config, &owner, create_args)
            .await
            .unwrap();
        // Fetch a real rent budget before going offline, large enough for each
        // supported proof context and the largest range-proof record.
        let proof_lamports = rpc
            .get_minimum_balance_for_rent_exemption(4096)
            .await
            .unwrap();
        Self {
            watched: vec![fixture_payer.pubkey(), owner.pubkey(), mint.pubkey()],
            config,
            payer: fixture_payer,
            owner,
            owner_file,
            cli_config_file,
            mint: mint.pubkey(),
            proof_lamports,
        }
    }

    async fn online(&self, command: &[&str]) -> String {
        process_test_command(
            &self.config,
            &self.owner,
            args(&["spl-token"]).into_iter().chain(args(command)),
        )
        .await
        .unwrap()
    }

    async fn account(&mut self, associated: bool) -> Pubkey {
        let account = if associated {
            create_associated_account(&self.config, &self.owner, &self.mint, &self.owner.pubkey())
                .await
        } else {
            create_auxiliary_account(&self.config, &self.owner, self.mint).await
        };
        self.watched.push(account);
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
        blockhash: Hash,
        format: Option<&str>,
        dump: bool,
    ) -> assert_cmd::Command {
        let mut binary = cargo_bin_cmd!("spl-token");
        binary
            .args(command)
            .args([
                "--config",
                self.cli_config_file.path().to_str().unwrap(),
                "--url",
                "http://127.0.0.1:1",
                "--program-id",
                &spl_token_2022_interface::id().to_string(),
                "--fee-payer",
                &self.payer.pubkey().to_string(),
                "--sign-only",
                "--blockhash",
                &blockhash.to_string(),
            ])
            .timeout(Duration::from_secs(60));
        if let Some(format) = format {
            binary.args(["--output", format]);
        }
        if dump {
            binary.arg("--dump-transaction-message");
        }
        binary
    }

    async fn output(
        &self,
        command: &[String],
        blockhash: Hash,
        format: Option<&str>,
        dump: bool,
    ) -> Output {
        let before = self
            .config
            .rpc_client
            .get_multiple_accounts(&self.watched)
            .await
            .unwrap();
        let output = self
            .binary(command, blockhash, format, dump)
            .output()
            .unwrap();
        let after = self
            .config
            .rpc_client
            .get_multiple_accounts(&self.watched)
            .await
            .unwrap();
        assert_eq!(before, after, "offline invocation changed account state");
        output
    }

    async fn generate(&self, command: &[String]) -> Value {
        let blockhash = self.config.rpc_client.get_latest_blockhash().await.unwrap();
        let output = self
            .output(command, blockhash, Some("json-compact"), true)
            .await;
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let value: Value = serde_json::from_slice(&output.stdout).unwrap();
        for transaction in transaction_data(&value) {
            assert_eq!(transaction["blockhash"], blockhash.to_string());
        }
        value
    }

    async fn error(&self, command: &[String], expected: &str) {
        let blockhash = self.config.rpc_client.get_latest_blockhash().await.unwrap();
        let output = self
            .output(command, blockhash, Some("json-compact"), true)
            .await;
        assert!(!output.status.success());
        let error = String::from_utf8_lossy(&output.stderr);
        assert!(
            error.contains(expected),
            "expected {expected:?}, got {error}"
        );
        assert!(!error.contains("panicked"), "{error}");
    }

    async fn submit(&self, value: &Value, expected_labels: &[&str]) {
        self.submit_with_signers(value, expected_labels, &[]).await;
    }

    async fn submit_with_signers(
        &self,
        value: &Value,
        expected_labels: &[&str],
        extra_signers: &[&Keypair],
    ) {
        let data = transaction_data(value);
        let labels = value
            .get("transactions")
            .map(|transactions| {
                transactions
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|transaction| transaction["transaction"].as_str().unwrap())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let mut previous_index = 0;
        for expected in expected_labels {
            let index = labels
                .iter()
                .position(|label| *label == *expected || label.starts_with(&format!("{expected} ")))
                .unwrap_or_else(|| panic!("missing {expected} in {labels:?}"));
            assert!(
                index >= previous_index,
                "invalid execution order: {labels:?}"
            );
            previous_index = index;
        }
        let mut temporary_accounts = BTreeSet::new();
        for transaction_data in data {
            let bytes = STANDARD
                .decode(transaction_data["message"].as_str().unwrap())
                .unwrap();
            let message: Message = bincode::deserialize(&bytes).unwrap();
            assert_eq!(message.serialize(), bytes);
            assert_eq!(
                message.recent_blockhash.to_string(),
                transaction_data["blockhash"]
            );
            let required_signers = message.account_keys
                [..usize::from(message.header.num_required_signatures)]
                .to_vec();
            let mut transaction = Transaction::new_unsigned(message);
            let mut original_signatures = Vec::new();
            for signer in transaction_data
                .get("signers")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let (pubkey, signature) = signer.as_str().unwrap().split_once('=').unwrap();
                let pubkey = Pubkey::from_str(pubkey).unwrap();
                let signature = Signature::from_str(signature).unwrap();
                assert!(signature.verify(pubkey.as_ref(), &bytes));
                let index = required_signers
                    .iter()
                    .position(|required| required == &pubkey)
                    .unwrap();
                transaction.signatures[index] = signature;
                original_signatures.push((index, signature));
            }
            for pubkey in &required_signers {
                if *pubkey != self.owner.pubkey()
                    && *pubkey != self.payer.pubkey()
                    && !extra_signers
                        .iter()
                        .any(|signer| signer.pubkey() == *pubkey)
                {
                    let index = required_signers
                        .iter()
                        .position(|required| required == pubkey)
                        .unwrap();
                    assert_ne!(
                        transaction.signatures[index],
                        Signature::default(),
                        "temporary signer signature omitted"
                    );
                    temporary_accounts.insert(*pubkey);
                }
            }
            let signing_keypairs: Vec<&dyn Signer> = [&self.payer, &self.owner]
                .into_iter()
                .chain(extra_signers.iter().copied())
                .filter(|signer| required_signers.contains(&signer.pubkey()))
                .map(|signer| signer as &dyn Signer)
                .collect();
            transaction.partial_sign(&signing_keypairs, transaction.message.recent_blockhash);
            assert_eq!(transaction.message.serialize(), bytes);
            for (index, signature) in original_signatures {
                assert_eq!(transaction.signatures[index], signature);
            }
            transaction.verify().unwrap();
            self.config
                .rpc_client
                .send_and_confirm_transaction(&transaction)
                .await
                .unwrap();
        }
        for temporary in temporary_accounts {
            assert!(
                self.config
                    .rpc_client
                    .get_account(&temporary)
                    .await
                    .is_err(),
                "proof account {temporary} was not cleaned up"
            );
        }
    }

    async fn apply_args(&self, account: Pubkey) -> Vec<String> {
        let extension = self.extension(account).await;
        let mut command = args(&[
            "apply-pending-balance",
            "--address",
            &account.to_string(),
            "--mint-address",
            &self.mint.to_string(),
            "--pending-balance-lo",
            &extension.pending_balance_lo.to_string(),
            "--pending-balance-hi",
            &extension.pending_balance_hi.to_string(),
            "--decryptable-available-balance",
            &extension.decryptable_available_balance.to_string(),
            "--pending-balance-credit-counter",
            &u64::from(extension.pending_balance_credit_counter).to_string(),
        ]);
        if extension.decryptable_available_balance == PodAeCiphertext::default() {
            command.extend(args(&[
                "--available-balance",
                &extension.available_balance.to_string(),
            ]));
        }
        command
    }

    async fn apply(&self, account: Pubkey) {
        let command = self.apply_args(account).await;
        self.submit(&self.generate(&command).await, &[]).await;
    }

    async fn balances(&self, account: Pubkey, pending: u64, available: u64) {
        assert_eq!(
            decrypted_confidential_balances(&self.config, &self.owner, &account).await,
            (pending as f64, available as f64)
        );
    }

    async fn fund_confidential(&self, account: Pubkey, amount: &str) {
        self.online(&["mint", &self.mint.to_string(), amount, &account.to_string()])
            .await;
        self.online(&[
            "deposit-confidential-tokens",
            &self.mint.to_string(),
            amount,
            "--address",
            &account.to_string(),
        ])
        .await;
        self.online(&["apply-pending-balance", "--address", &account.to_string()])
            .await;
    }

    async fn transfer_args(
        &self,
        source: Pubkey,
        destination: Pubkey,
        amount: &str,
    ) -> Vec<String> {
        let source_extension = self.extension(source).await;
        let destination_extension = self.extension(destination).await;
        args(&[
            "transfer",
            &self.mint.to_string(),
            amount,
            &destination.to_string(),
            "--confidential",
            "--no-recipient-is-ata-owner",
            "--from",
            &source.to_string(),
            "--mint-decimals",
            "0",
            "--available-balance",
            &source_extension.available_balance.to_string(),
            "--decryptable-available-balance",
            &source_extension.decryptable_available_balance.to_string(),
            "--recipient-elgamal-pubkey",
            &destination_extension.elgamal_pubkey.to_string(),
            "--auditor-pubkey",
            "none",
            "--proof-account-lamports",
            &self.proof_lamports.to_string(),
        ])
    }
}

fn transaction_data(value: &Value) -> Vec<&Value> {
    value.get("transactions").map_or_else(
        || vec![value],
        |transactions| transactions.as_array().unwrap().iter().collect(),
    )
}

pub async fn offline_confidential_commands(test_validator: &TestValidator, payer: &Keypair) {
    let mut fixture = Fixture::new(
        test_validator,
        payer,
        &["--enable-confidential-transfers", "manual"],
    )
    .await;
    let account = fixture.account(true).await;
    let configure = args(&[
        "configure-confidential-transfer-account",
        &fixture.mint.to_string(),
    ]);
    fixture.error(&configure, "reallocate").await;
    let mut configure = configure;
    configure.push("--reallocate".to_string());
    fixture
        .submit(
            &fixture.generate(&configure).await,
            &[
                "reallocate account",
                "configure confidential transfer account",
            ],
        )
        .await;
    assert!(!bool::from(fixture.extension(account).await.approved));
    let approve = args(&[
        "approve-confidential-transfer-account",
        "--address",
        &account.to_string(),
        "--mint-address",
        &fixture.mint.to_string(),
    ]);
    fixture.submit(&fixture.generate(&approve).await, &[]).await;
    assert!(bool::from(fixture.extension(account).await.approved));

    for (command, confidential, enabled) in [
        ("disable-confidential-credits", true, false),
        ("enable-confidential-credits", true, true),
        ("disable-non-confidential-credits", false, false),
        ("enable-non-confidential-credits", false, true),
    ] {
        let command = args(&[
            command,
            &fixture.mint.to_string(),
            "--owner",
            &fixture.owner.pubkey().to_string(),
        ]);
        fixture.submit(&fixture.generate(&command).await, &[]).await;
        let extension = fixture.extension(account).await;
        assert_eq!(
            bool::from(if confidential {
                extension.allow_confidential_credits
            } else {
                extension.allow_non_confidential_credits
            }),
            enabled
        );
    }
    let settings = args(&[
        "update-confidential-transfer-settings",
        &fixture.mint.to_string(),
        "--approve-policy",
        "auto",
        "--auditor-pubkey",
        "none",
    ]);
    fixture
        .error(&settings[..settings.len() - 2], "auditor")
        .await;
    fixture
        .submit(&fixture.generate(&settings).await, &[])
        .await;
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
        "100",
        "--mint-decimals",
        "0",
    ]);
    let blockhash = fixture
        .config
        .rpc_client
        .get_latest_blockhash()
        .await
        .unwrap();
    for format in [None, Some("json"), Some("json-compact")] {
        let output = fixture.output(&deposit, blockhash, format, true).await;
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        if format.is_some() {
            let value: Value = serde_json::from_slice(&output.stdout).unwrap();
            assert!(value.get("transactions").is_none());
            assert_eq!(value["blockhash"], blockhash.to_string());
            assert!(value["message"].is_string());
        } else {
            let output = String::from_utf8(output.stdout).unwrap();
            assert!(output.contains("Blockhash:"));
            assert!(output.contains("Message:"));
        }
    }
    let no_message = fixture
        .output(&deposit, blockhash, Some("json-compact"), false)
        .await;
    assert!(no_message.status.success());
    assert!(serde_json::from_slice::<Value>(&no_message.stdout)
        .unwrap()
        .get("message")
        .is_none());
    let mut public_owner = deposit.clone();
    public_owner.extend(args(&["--owner", &fixture.owner.pubkey().to_string()]));
    let unsigned = fixture.generate(&public_owner).await;
    let message: Message = bincode::deserialize(
        &STANDARD
            .decode(unsigned["message"].as_str().unwrap())
            .unwrap(),
    )
    .unwrap();
    let blockhash = message.recent_blockhash;
    let mut signed = Transaction::new_unsigned(message);
    signed.sign(&[&fixture.owner, &fixture.payer], blockhash);
    for (pubkey, signature) in signed.message.account_keys.iter().zip(&signed.signatures) {
        public_owner.extend(args(&["--signer", &format!("{pubkey}={signature}")]));
    }
    let output = fixture
        .output(&public_owner, blockhash, Some("json-compact"), true)
        .await;
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let completed: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(completed["message"], unsigned["message"]);
    assert_eq!(completed["signers"].as_array().unwrap().len(), 2);
    assert!(completed
        .get("absent")
        .and_then(Value::as_array)
        .is_none_or(Vec::is_empty));
    fixture.submit(&completed, &[]).await;
    fixture.balances(account, 100, 0).await;
    fixture.apply(account).await;
    fixture.balances(account, 0, 100).await;

    let extension = fixture.extension(account).await;
    let withdraw = args(&[
        "withdraw-confidential-tokens",
        &fixture.mint.to_string(),
        "100",
        "--address",
        &account.to_string(),
        "--mint-decimals",
        "0",
        "--available-balance",
        &extension.available_balance.to_string(),
        "--decryptable-available-balance",
        &extension.decryptable_available_balance.to_string(),
        "--proof-account-lamports",
        &fixture.proof_lamports.to_string(),
    ]);
    let mut missing = withdraw.clone();
    let index = missing
        .iter()
        .position(|arg| arg == "--available-balance")
        .unwrap();
    missing.drain(index..index + 2);
    fixture.error(&missing, "available-balance").await;
    let mut malformed = withdraw.clone();
    malformed[index + 1] = "invalid-ciphertext".to_string();
    fixture.error(&malformed, "invalid").await;
    let mut public_owner = withdraw.clone();
    public_owner.extend(args(&["--owner", &fixture.owner.pubkey().to_string()]));
    fixture.error(&public_owner, "sign").await;
    let mut multisig = withdraw.clone();
    multisig.extend(args(&[
        "--multisig-signer",
        fixture.owner_file.path().to_str().unwrap(),
    ]));
    fixture
        .error(
            &multisig,
            "Encryption-key derivation for multisig authorities is unsupported offline",
        )
        .await;
    let mut multisig = fixture.apply_args(account).await;
    multisig.extend(args(&[
        "--multisig-signer",
        fixture.owner_file.path().to_str().unwrap(),
    ]));
    fixture
        .error(
            &multisig,
            "Encryption-key derivation for multisig authorities is unsupported offline",
        )
        .await;
    let mut missing_rent = withdraw.clone();
    missing_rent.truncate(missing_rent.len() - 2);
    fixture.error(&missing_rent, "proof-account-lamports").await;
    fixture
        .submit(
            &fixture.generate(&withdraw).await,
            &[
                "create equality proof context",
                "create range proof record",
                "create range proof context",
                "confidential withdrawal",
                "close equality proof context",
                "close range proof context",
                "close range proof record",
            ],
        )
        .await;
    fixture.balances(account, 0, 0).await;
    let state = fixture
        .config
        .rpc_client
        .get_account(&account)
        .await
        .unwrap();
    assert_eq!(
        StateWithExtensionsOwned::<Account>::unpack(state.data)
            .unwrap()
            .base
            .amount,
        100
    );
    let extension = fixture.extension(account).await;
    let empty = args(&[
        "empty-confidential-transfer-account",
        "--address",
        &account.to_string(),
        "--mint-address",
        &fixture.mint.to_string(),
        "--available-balance",
        &extension.available_balance.to_string(),
    ]);
    fixture.submit(&fixture.generate(&empty).await, &[]).await;

    // Offline configuration also supports accounts already allocated online.
    let preallocated = fixture.account(false).await;
    Token::new(
        fixture.config.program_client.clone(),
        &fixture.config.program_id,
        &fixture.mint,
        Some(0),
        fixture.config.fee_payer().unwrap(),
    )
    .reallocate(
        &preallocated,
        &fixture.owner.pubkey(),
        &[ExtensionType::ConfidentialTransferAccount],
        &[&fixture.owner],
    )
    .await
    .unwrap();
    let configure = args(&[
        "configure-confidential-transfer-account",
        "--address",
        &preallocated.to_string(),
        "--mint-address",
        &fixture.mint.to_string(),
        "--account-is-preallocated",
    ]);
    let output = fixture.generate(&configure).await;
    assert!(output.get("transactions").is_none());
    fixture.submit(&output, &[]).await;
    assert!(bool::from(fixture.extension(preallocated).await.approved));

    let ordinary_transfer = args(&[
        "transfer",
        &fixture.mint.to_string(),
        "1",
        &preallocated.to_string(),
        "--from",
        &account.to_string(),
        "--mint-decimals",
        "0",
        "--no-recipient-is-ata-owner",
    ]);
    let output = fixture.generate(&ordinary_transfer).await;
    assert!(output.get("transactions").is_none());
    fixture.submit(&output, &[]).await;
    let state = fixture
        .config
        .rpc_client
        .get_account(&preallocated)
        .await
        .unwrap();
    assert_eq!(
        StateWithExtensionsOwned::<Account>::unpack(state.data)
            .unwrap()
            .base
            .amount,
        1
    );

    // State-free operations retain ordinary multisig partial signing.
    let multisig = Keypair::new();
    let multisig_file = NamedTempFile::new().unwrap();
    write_keypair_file(&multisig, &multisig_file).unwrap();
    let member_one = Keypair::new();
    let member_two = Keypair::new();
    let member_one_file = NamedTempFile::new().unwrap();
    write_keypair_file(&member_one, &member_one_file).unwrap();
    fixture
        .online(&[
            "create-multisig",
            "1",
            &member_one.pubkey().to_string(),
            &member_two.pubkey().to_string(),
            "--address-keypair",
            multisig_file.path().to_str().unwrap(),
        ])
        .await;
    fixture.watched.push(multisig.pubkey());
    fixture
        .online(&[
            "authorize",
            &preallocated.to_string(),
            "owner",
            &multisig.pubkey().to_string(),
        ])
        .await;
    let deposit = args(&[
        "deposit-confidential-tokens",
        &fixture.mint.to_string(),
        "1",
        "--address",
        &preallocated.to_string(),
        "--mint-decimals",
        "0",
        "--owner",
        &multisig.pubkey().to_string(),
        "--multisig-signer",
        member_one_file.path().to_str().unwrap(),
        "--multisig-signer",
        &member_two.pubkey().to_string(),
    ]);
    let output = fixture.generate(&deposit).await;
    assert!(output["signers"]
        .as_array()
        .unwrap()
        .iter()
        .any(|signature| signature
            .as_str()
            .unwrap()
            .starts_with(&member_one.pubkey().to_string())));
    assert!(output["absent"]
        .as_array()
        .unwrap()
        .iter()
        .any(|pubkey| pubkey == &member_two.pubkey().to_string()));
    fixture
        .submit_with_signers(&output, &[], &[&member_one, &member_two])
        .await;
    let state = fixture
        .config
        .rpc_client
        .get_account(&preallocated)
        .await
        .unwrap();
    let state = StateWithExtensionsOwned::<Account>::unpack(state.data).unwrap();
    assert_eq!(state.base.amount, 0);
    assert_eq!(
        u64::from(
            state
                .get_extension::<ConfidentialTransferAccount>()
                .unwrap()
                .pending_balance_credit_counter
        ),
        1
    );

    // A single transaction keeps the existing durable nonce semantics.
    let nonce = create_nonce(&fixture.config, &fixture.owner).await;
    let nonce_account = fixture.config.rpc_client.get_account(&nonce).await.unwrap();
    let nonce_hash = Hash::new_from_array(nonce_account.data[40..72].try_into().unwrap());
    let mut nonce_deposit = args(&[
        "deposit-confidential-tokens",
        &fixture.mint.to_string(),
        "1",
        "--mint-decimals",
        "0",
    ]);
    nonce_deposit.extend(args(&[
        "--nonce",
        &nonce.to_string(),
        "--nonce-authority",
        fixture.owner_file.path().to_str().unwrap(),
    ]));
    let output = fixture
        .output(&nonce_deposit, nonce_hash, Some("json-compact"), true)
        .await;
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["blockhash"], nonce_hash.to_string());
    fixture.submit(&value, &[]).await;
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
}

pub async fn offline_confidential_registry(test_validator: &TestValidator, payer: &Keypair) {
    let mut fixture = Fixture::new(
        test_validator,
        payer,
        &["--enable-confidential-transfers", "auto"],
    )
    .await;
    let account = fixture.account(true).await;
    let (elgamal_keypair, _) = derive_confidential_keys(&fixture.owner, b"").unwrap();
    let registry = spl_elgamal_registry_interface::get_elgamal_registry_address(
        &fixture.owner.pubkey(),
        &spl_elgamal_registry_interface::id(),
    );
    let proof = build_pubkey_validity_proof_data(&elgamal_keypair).unwrap();
    let rent = fixture
        .config
        .rpc_client
        .get_minimum_balance_for_rent_exemption(
            spl_elgamal_registry_interface::state::ELGAMAL_REGISTRY_ACCOUNT_LEN,
        )
        .await
        .unwrap();
    let mut instructions = vec![system_instruction::transfer(
        &fixture.payer.pubkey(),
        &registry,
        rent,
    )];
    instructions.extend(
        spl_elgamal_registry_interface::instruction::create_registry(
            &fixture.owner.pubkey(),
            ProofLocation::InstructionOffset(1.try_into().unwrap(), &proof),
        )
        .unwrap(),
    );
    let transaction = Transaction::new_signed_with_payer(
        &instructions,
        Some(&fixture.payer.pubkey()),
        &[&fixture.payer, &fixture.owner],
        fixture
            .config
            .rpc_client
            .get_latest_blockhash()
            .await
            .unwrap(),
    );
    fixture
        .config
        .rpc_client
        .send_and_confirm_transaction(&transaction)
        .await
        .unwrap();
    fixture.watched.push(registry);

    let configure = args(&[
        "configure-confidential-transfer-account",
        &fixture.mint.to_string(),
        "--owner",
        &fixture.owner.pubkey().to_string(),
        "--elgamal-registry",
        &registry.to_string(),
    ]);
    let output = fixture.generate(&configure).await;
    let message: Message = bincode::deserialize(
        &STANDARD
            .decode(output["message"].as_str().unwrap())
            .unwrap(),
    )
    .unwrap();
    assert_eq!(message.header.num_required_signatures, 1);
    assert_eq!(message.account_keys[0], fixture.payer.pubkey());
    fixture.submit(&output, &[]).await;
    let extension = fixture.extension(account).await;
    assert_eq!(extension.available_balance, PodElGamalCiphertext::default());
    assert_eq!(
        extension.decryptable_available_balance,
        PodAeCiphertext::default()
    );
    fixture
        .online(&["mint", &fixture.mint.to_string(), "2", &account.to_string()])
        .await;

    for available in [1, 2] {
        let deposit = args(&[
            "deposit-confidential-tokens",
            &fixture.mint.to_string(),
            "1",
            "--mint-decimals",
            "0",
            "--owner",
            &fixture.owner.pubkey().to_string(),
        ]);
        fixture.submit(&fixture.generate(&deposit).await, &[]).await;
        if available == 1 {
            let apply = fixture.apply_args(account).await;
            for flag in [
                "--available-balance",
                "--pending-balance-credit-counter",
                "--decryptable-available-balance",
            ] {
                let mut missing = apply.clone();
                let index = missing.iter().position(|arg| arg == flag).unwrap();
                missing.drain(index..index + 2);
                fixture.error(&missing, flag).await;
            }
            for (flag, malformed) in [
                ("--pending-balance-credit-counter", "invalid-counter"),
                ("--decryptable-available-balance", "invalid-ciphertext"),
            ] {
                let mut invalid = apply.clone();
                let index = invalid.iter().position(|arg| arg == flag).unwrap();
                invalid[index + 1] = malformed.to_string();
                fixture.error(&invalid, flag).await;
            }
            let mut invalid = apply;
            let (_, wrong_aes) = derive_confidential_keys(&Keypair::new(), b"").unwrap();
            let ciphertext: PodAeCiphertext = wrong_aes.encrypt(0).into();
            let index = invalid
                .iter()
                .position(|arg| arg == "--decryptable-available-balance")
                .unwrap();
            invalid[index + 1] = ciphertext.to_string();
            fixture.error(&invalid, "AccountDecryption").await;
        }
        fixture.apply(account).await;
        fixture.balances(account, 0, available).await;
    }
}

pub async fn offline_confidential_transfer(test_validator: &TestValidator, payer: &Keypair) {
    let mut fixture = Fixture::new(
        test_validator,
        payer,
        &["--enable-confidential-transfers", "auto"],
    )
    .await;
    let source = fixture.account(true).await;
    let destination = fixture.account(false).await;
    for account in [source, destination] {
        fixture
            .online(&[
                "configure-confidential-transfer-account",
                "--address",
                &account.to_string(),
            ])
            .await;
    }
    fixture.fund_confidential(source, "100").await;
    let mut transfer = fixture.transfer_args(source, destination, "60").await;
    let mut oversized = transfer.clone();
    oversized.extend(args(&["--with-memo", &"m".repeat(1233)]));
    fixture.error(&oversized, "packet limit").await;
    transfer.extend(args(&["--with-memo", "offline confidential transfer"]));
    let blockhash = fixture
        .config
        .rpc_client
        .get_latest_blockhash()
        .await
        .unwrap();
    for format in [None, Some("json"), Some("json-compact")] {
        // Multi-transaction messages are retained even without --dump so their
        // generated temporary signer signatures remain usable later.
        let output = fixture.output(&transfer, blockhash, format, false).await;
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        if format.is_some() {
            let value: Value = serde_json::from_slice(&output.stdout).unwrap();
            assert!(value["transactions"].as_array().unwrap().len() > 1);
            for transaction in transaction_data(&value) {
                assert!(transaction["message"].is_string());
                assert_eq!(transaction["blockhash"], blockhash.to_string());
            }
        } else {
            let output = String::from_utf8(output.stdout).unwrap();
            assert!(output.contains("execute in this order"));
            assert!(output.contains("create range proof record"));
            assert!(output.contains("close range proof record"));
        }
    }
    let mut nonce_transfer = transfer.clone();
    nonce_transfer.extend(args(&[
        "--nonce",
        &Pubkey::new_unique().to_string(),
        "--nonce-authority",
        fixture.owner_file.path().to_str().unwrap(),
    ]));
    fixture.error(&nonce_transfer, "nonce").await;
    let output = fixture.generate(&transfer).await;
    for transaction in output["transactions"].as_array().unwrap() {
        let message: Message = bincode::deserialize(
            &STANDARD
                .decode(transaction["message"].as_str().unwrap())
                .unwrap(),
        )
        .unwrap();
        let memos = message
            .instructions
            .iter()
            .filter(|instruction| {
                message.account_keys[usize::from(instruction.program_id_index)]
                    == spl_memo_interface::v4::id()
            })
            .collect::<Vec<_>>();
        if transaction["transaction"] == "confidential transfer" {
            assert_eq!(memos.len(), 1);
            assert_eq!(memos[0].data, b"offline confidential transfer");
        } else {
            assert!(
                memos.is_empty(),
                "setup and cleanup must not consume the operation memo"
            );
        }
    }
    assert!(
        output["transactions"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|transaction| {
                transaction["transaction"]
                    .as_str()
                    .unwrap()
                    .starts_with("create range proof record")
            })
            .count()
            >= 2,
        "range proof setup and subsequent writes must all be returned"
    );
    fixture
        .submit(
            &output,
            &[
                "create equality proof context",
                "create ciphertext validity proof context",
                "create range proof record",
                "create range proof context",
                "confidential transfer",
                "close equality proof context",
                "close ciphertext validity proof context",
                "close range proof context",
                "close range proof record",
            ],
        )
        .await;
    fixture.balances(source, 0, 40).await;
    fixture.balances(destination, 60, 0).await;
    fixture.apply(destination).await;
    fixture.balances(destination, 0, 60).await;
}

pub async fn offline_confidential_transfer_fees(test_validator: &TestValidator, payer: &Keypair) {
    let mut fixture = Fixture::new(
        test_validator,
        payer,
        &[
            "--enable-confidential-transfers",
            "auto",
            "--transfer-fee-basis-points",
            "1000",
            "--transfer-fee-maximum-fee",
            "100",
        ],
    )
    .await;
    let source = fixture.account(true).await;
    let destination = fixture.account(false).await;
    for account in [source, destination] {
        let configure = args(&[
            "configure-confidential-transfer-account",
            "--address",
            &account.to_string(),
            "--mint-address",
            &fixture.mint.to_string(),
            "--reallocate",
            "--confidential-transfer-fee",
        ]);
        fixture
            .submit(
                &fixture.generate(&configure).await,
                &[
                    "reallocate account",
                    "configure confidential transfer account",
                ],
            )
            .await;
    }
    fixture.fund_confidential(source, "200").await;
    let mint = fixture.mint_state().await;
    let fee_config = mint
        .get_extension::<ConfidentialTransferFeeConfig>()
        .unwrap();
    let fee = mint
        .get_extension::<TransferFeeConfig>()
        .unwrap()
        .get_epoch_fee(
            fixture
                .config
                .rpc_client
                .get_epoch_info()
                .await
                .unwrap()
                .epoch,
        );
    let mut transfer = fixture.transfer_args(source, destination, "100").await;
    let fee_args = args(&[
        "--expected-fee",
        "10",
        "--transfer-fee-basis-points",
        &u16::from(fee.transfer_fee_basis_points).to_string(),
        "--transfer-fee-maximum-fee",
        &u64::from(fee.maximum_fee).to_string(),
        "--withdraw-withheld-authority-elgamal-pubkey",
        &fee_config
            .withdraw_withheld_authority_elgamal_pubkey
            .to_string(),
    ]);
    transfer.extend(fee_args);
    fixture.error(&transfer, "with-compute-unit-limit").await;
    transfer.extend(args(&["--with-compute-unit-limit", "500000"]));
    fixture
        .submit(
            &fixture.generate(&transfer).await,
            &[
                "create equality proof context",
                "create ciphertext validity proof context",
                "create percentage with cap proof context",
                "create fee ciphertext validity proof context",
                "create range proof record",
                "create range proof context",
                "confidential transfer with fee",
                "close equality proof context",
                "close ciphertext validity proof context",
                "close percentage with cap proof context",
                "close fee ciphertext validity proof context",
                "close range proof context",
                "close range proof record",
            ],
        )
        .await;
    fixture.balances(source, 0, 100).await;
    fixture.balances(destination, 90, 0).await;
    fixture.apply(destination).await;
    fixture.balances(destination, 0, 90).await;

    // Withdraw an account's actual encrypted fees without fetching it while signing.
    let account = fixture
        .config
        .rpc_client
        .get_account(&destination)
        .await
        .unwrap();
    let state = StateWithExtensionsOwned::<Account>::unpack(account.data).unwrap();
    let amount = state
        .get_extension::<ConfidentialTransferFeeAmount>()
        .unwrap()
        .withheld_amount;
    let extension = fixture.extension(source).await;
    let withdrawal = args(&[
        "withdraw-withheld-tokens",
        &source.to_string(),
        &destination.to_string(),
        "--confidential",
        "--mint-address",
        &fixture.mint.to_string(),
        "--recipient-elgamal-pubkey",
        &extension.elgamal_pubkey.to_string(),
        "--decryptable-available-balance",
        &extension.decryptable_available_balance.to_string(),
        "--withheld-amount",
        &amount.to_string(),
    ]);
    fixture
        .submit(&fixture.generate(&withdrawal).await, &[])
        .await;
    fixture.balances(source, 0, 110).await;

    for (command, enabled) in [
        ("disable-confidential-fee-harvesting", false),
        ("enable-confidential-fee-harvesting", true),
    ] {
        fixture
            .submit(
                &fixture
                    .generate(&args(&[command, &fixture.mint.to_string()]))
                    .await,
                &[],
            )
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

    // Keep a nonzero fee on the mint and a different nonzero fee on an account,
    // so a two-transaction withdrawal must update the decryptable balance twice.
    for harvest in [true, false] {
        let mut transfer = fixture.transfer_args(source, destination, "10").await;
        transfer.extend(args(&[
            "--expected-fee",
            "1",
            "--transfer-fee-basis-points",
            &u16::from(fee.transfer_fee_basis_points).to_string(),
            "--transfer-fee-maximum-fee",
            &u64::from(fee.maximum_fee).to_string(),
            "--withdraw-withheld-authority-elgamal-pubkey",
            &fee_config
                .withdraw_withheld_authority_elgamal_pubkey
                .to_string(),
        ]));
        transfer.extend(args(&["--with-compute-unit-limit", "500000"]));
        fixture
            .submit(&fixture.generate(&transfer).await, &[])
            .await;
        if harvest {
            let harvest = args(&[
                "harvest-withheld-confidential-tokens",
                &fixture.mint.to_string(),
                &destination.to_string(),
            ]);
            fixture.submit(&fixture.generate(&harvest).await, &[]).await;
        }
    }
    fixture.balances(source, 0, 90).await;
    let mint = fixture.mint_state().await;
    let mint_amount = mint
        .get_extension::<ConfidentialTransferFeeConfig>()
        .unwrap()
        .withheld_amount;
    let account = fixture
        .config
        .rpc_client
        .get_account(&destination)
        .await
        .unwrap();
    let state = StateWithExtensionsOwned::<Account>::unpack(account.data).unwrap();
    let account_amount = state
        .get_extension::<ConfidentialTransferFeeAmount>()
        .unwrap()
        .withheld_amount;
    let extension = fixture.extension(source).await;
    let mut withdrawal = args(&[
        "withdraw-withheld-tokens",
        &source.to_string(),
        &destination.to_string(),
        &destination.to_string(),
        "--include-mint",
        "--confidential",
        "--mint-address",
        &fixture.mint.to_string(),
        "--recipient-elgamal-pubkey",
        &extension.elgamal_pubkey.to_string(),
        "--decryptable-available-balance",
        &extension.decryptable_available_balance.to_string(),
        "--withheld-amount",
        &mint_amount.to_string(),
    ]);
    fixture.error(&withdrawal, "one --withheld-amount").await;
    withdrawal.extend(args(&["--withheld-amount", &account_amount.to_string()]));
    let output = fixture.generate(&withdrawal).await;
    assert_eq!(output["transactions"].as_array().unwrap().len(), 2);
    fixture
        .submit(
            &output,
            &[
                "withdraw confidential fees 1",
                "withdraw confidential fees 2",
            ],
        )
        .await;
    fixture.balances(source, 0, 92).await;
    let mint = fixture.mint_state().await;
    assert_eq!(
        mint.get_extension::<ConfidentialTransferFeeConfig>()
            .unwrap()
            .withheld_amount,
        PodElGamalCiphertext::default()
    );
    let account = fixture
        .config
        .rpc_client
        .get_account(&destination)
        .await
        .unwrap();
    let state = StateWithExtensionsOwned::<Account>::unpack(account.data).unwrap();
    assert_eq!(
        state
            .get_extension::<ConfidentialTransferFeeAmount>()
            .unwrap()
            .withheld_amount,
        PodElGamalCiphertext::default()
    );
}

pub async fn offline_confidential_mint_burn(test_validator: &TestValidator, payer: &Keypair) {
    use solana_zk_sdk::encryption::elgamal::ElGamalCiphertext;

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
            "configure-confidential-transfer-account",
            &fixture.mint.to_string(),
        ])
        .await;
    let mint = fixture.mint_state().await;
    let supply = mint.get_extension::<ConfidentialMintBurn>().unwrap();
    let extension = fixture.extension(account).await;
    let command = args(&[
        "mint",
        &fixture.mint.to_string(),
        "100",
        &account.to_string(),
        "--confidential",
        "--mint-decimals",
        "0",
        "--mint-authority",
        fixture.owner_file.path().to_str().unwrap(),
        "--confidential-supply",
        &supply.confidential_supply.to_string(),
        "--decryptable-supply",
        &supply.decryptable_supply.to_string(),
        "--recipient-elgamal-pubkey",
        &extension.elgamal_pubkey.to_string(),
        "--auditor-pubkey",
        "none",
        "--proof-account-lamports",
        &fixture.proof_lamports.to_string(),
    ]);
    // Supply key derivation must use the explicit mint authority, even when
    // the CLI configuration identifies a different default signer.
    let wrong_default_file = NamedTempFile::new().unwrap();
    write_keypair_file(&Keypair::new(), &wrong_default_file).unwrap();
    let mut cli_config = solana_cli_config::Config {
        keypair_path: wrong_default_file.path().to_str().unwrap().to_string(),
        json_rpc_url: "http://127.0.0.1:1".to_string(),
        ..solana_cli_config::Config::default()
    };
    cli_config
        .save(fixture.cli_config_file.path().to_str().unwrap())
        .unwrap();
    let output = fixture.generate(&command).await;
    cli_config.keypair_path = fixture.owner_file.path().to_str().unwrap().to_string();
    cli_config
        .save(fixture.cli_config_file.path().to_str().unwrap())
        .unwrap();
    fixture
        .submit(
            &output,
            &[
                "create equality proof context",
                "create ciphertext validity proof context",
                "create range proof record",
                "create range proof context",
                "confidential mint",
                "close equality proof context",
                "close ciphertext validity proof context",
                "close range proof context",
                "close range proof record",
            ],
        )
        .await;
    fixture.balances(account, 100, 0).await;
    fixture.apply(account).await;
    fixture.balances(account, 0, 100).await;
    let mint = fixture.mint_state().await;
    let supply = mint.get_extension::<ConfidentialMintBurn>().unwrap();
    let extension = fixture.extension(account).await;
    let command = args(&[
        "burn",
        &account.to_string(),
        "40",
        "--confidential",
        "--mint-address",
        &fixture.mint.to_string(),
        "--mint-decimals",
        "0",
        "--available-balance",
        &extension.available_balance.to_string(),
        "--decryptable-available-balance",
        &extension.decryptable_available_balance.to_string(),
        "--supply-elgamal-pubkey",
        &supply.supply_elgamal_pubkey.to_string(),
        "--auditor-pubkey",
        "none",
        "--proof-account-lamports",
        &fixture.proof_lamports.to_string(),
    ]);
    fixture
        .submit(
            &fixture.generate(&command).await,
            &[
                "create equality proof context",
                "create ciphertext validity proof context",
                "create range proof record",
                "create range proof context",
                "confidential burn",
                "close equality proof context",
                "close ciphertext validity proof context",
                "close range proof context",
                "close range proof record",
            ],
        )
        .await;
    fixture.balances(account, 0, 60).await;
    let command = args(&[
        "apply-pending-burn",
        &fixture.mint.to_string(),
        "--owner",
        &fixture.owner.pubkey().to_string(),
    ]);
    fixture.submit(&fixture.generate(&command).await, &[]).await;
    let (supply_keypair, supply_aes_key) = derive_confidential_keys(&fixture.owner, b"").unwrap();
    let mint = fixture.mint_state().await;
    let supply = mint.get_extension::<ConfidentialMintBurn>().unwrap();
    let ciphertext: ElGamalCiphertext = supply.confidential_supply.try_into().unwrap();
    assert_eq!(ciphertext.decrypt_u32(supply_keypair.secret()), Some(60));
    assert_eq!(supply.pending_burn, PodElGamalCiphertext::default());
    let decryptable_supply: PodAeCiphertext = supply_aes_key.encrypt(60).into();
    let command = args(&[
        "update-decryptable-supply",
        &fixture.mint.to_string(),
        &decryptable_supply.to_string(),
    ]);
    fixture.submit(&fixture.generate(&command).await, &[]).await;
    assert_eq!(
        fixture
            .mint_state()
            .await
            .get_extension::<ConfidentialMintBurn>()
            .unwrap()
            .decryptable_supply,
        decryptable_supply
    );
}
