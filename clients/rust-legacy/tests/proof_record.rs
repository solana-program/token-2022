use {
    async_trait::async_trait,
    bytemuck::{bytes_of, Pod, Zeroable},
    solana_account::Account,
    solana_address::Address,
    solana_compute_budget_interface::ComputeBudgetInstruction,
    solana_hash::Hash,
    solana_packet::PACKET_DATA_SIZE,
    solana_rpc_client_api::response::RpcSimulateTransactionResult,
    solana_sdk::signer::keypair::Keypair,
    solana_signer::Signer,
    solana_system_interface::instruction as system_instruction,
    solana_transaction::Transaction,
    solana_zk_elgamal_proof_interface::proof_data::{ProofType, ZkProofData},
    spl_token_client::{
        client::{
            ProgramClient, ProgramClientResult, ProgramOfflineClient,
            ProgramRpcClientSendTransaction, RpcClientResponse,
        },
        token::{ComputeUnitLimit, Token, TokenError},
    },
    std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
};

// Provide rent locally while using the existing offline transaction recorder.
// These tests construct signed transactions without submitting them to a validator.
#[derive(Debug)]
struct RecordClient {
    offline: ProgramOfflineClient<ProgramRpcClientSendTransaction>,
    sent: AtomicUsize,
    simulations: Mutex<Vec<Transaction>>,
}

#[async_trait]
impl ProgramClient<ProgramRpcClientSendTransaction> for RecordClient {
    async fn get_minimum_balance_for_rent_exemption(
        &self,
        _data_len: usize,
    ) -> ProgramClientResult<u64> {
        Ok(1_000_000)
    }

    async fn get_latest_blockhash(&self) -> ProgramClientResult<Hash> {
        self.offline.get_latest_blockhash().await
    }

    async fn send_transaction(
        &self,
        transaction: &Transaction,
    ) -> ProgramClientResult<RpcClientResponse> {
        self.sent.fetch_add(1, Ordering::Relaxed);
        self.offline.send_transaction(transaction).await
    }

    async fn get_account(&self, address: Address) -> ProgramClientResult<Option<Account>> {
        self.offline.get_account(address).await
    }

    async fn simulate_transaction(
        &self,
        transaction: &Transaction,
    ) -> ProgramClientResult<RpcClientResponse> {
        self.simulations.lock().unwrap().push(transaction.clone());
        Ok(RpcClientResponse::Simulation(
            RpcSimulateTransactionResult {
                units_consumed: Some(200_000),
                err: None,
                logs: None,
                accounts: None,
                loaded_accounts_data_size: None,
                return_data: None,
                inner_instructions: None,
                replacement_blockhash: None,
                fee: None,
                pre_balances: None,
                post_balances: None,
                pre_token_balances: None,
                post_token_balances: None,
                loaded_addresses: None,
            },
        ))
    }
}

fn token(payer: Arc<Keypair>) -> (Token<ProgramRpcClientSendTransaction>, Arc<RecordClient>) {
    let client = Arc::new(RecordClient {
        offline: ProgramOfflineClient::new(Hash::new_unique(), ProgramRpcClientSendTransaction),
        sent: AtomicUsize::new(0),
        simulations: Mutex::new(Vec::new()),
    });
    let token = Token::new(
        client.clone(),
        &spl_token_2022_interface::id(),
        &Address::new_unique(),
        Some(0),
        payer,
    );
    (token, client)
}

fn assert_record_bytes(
    responses: Vec<RpcClientResponse>,
    proof: &[u8],
    payer: &Address,
    record: &Address,
    authority: &Address,
) -> Vec<Transaction> {
    let transactions: Vec<_> = responses
        .into_iter()
        .map(|response| match response {
            RpcClientResponse::Transaction(transaction) => transaction,
            _ => panic!("expected a recorded transaction"),
        })
        .collect();
    let mut offset = 0_usize;
    for transaction in &transactions {
        assert_eq!(transaction.message.account_keys[0], *payer);
        transaction.verify().unwrap();
        assert!(bincode::serialized_size(transaction).unwrap() <= PACKET_DATA_SIZE as u64);
        let empty_write = spl_record::instruction::write(record, authority, offset as u64, &[]);
        let write = transaction
            .message
            .instructions
            .iter()
            .find(|instruction| {
                transaction.message.account_keys[usize::from(instruction.program_id_index)]
                    == spl_record::id()
                    && instruction.data.first() == empty_write.data.first()
            })
            .unwrap();
        let chunk_len = write
            .data
            .len()
            .checked_sub(empty_write.data.len())
            .unwrap();
        assert!(chunk_len > 0);
        let end = offset.checked_add(chunk_len).unwrap();
        let expected =
            spl_record::instruction::write(record, authority, offset as u64, &proof[offset..end]);
        assert_eq!(write.data, expected.data);
        offset = end;
    }
    assert_eq!(offset, proof.len());
    transactions
}

#[tokio::test]
async fn record_chunks_fit_with_memo_nonce_and_compute_budget() {
    let proof = LargeProof {
        body: [42_u8; 1024],
    };
    for (memo, nonce, limit) in [
        (false, false, ComputeUnitLimit::Default),
        (true, false, ComputeUnitLimit::Static(200_000)),
        (false, true, ComputeUnitLimit::Static(200_000)),
        (true, true, ComputeUnitLimit::Simulated),
    ] {
        let payer = Arc::new(Keypair::new());
        let authority = Keypair::new();
        let record = Keypair::new();
        let (mut token, client) = token(payer.clone());
        token = token
            .with_compute_unit_limit(limit.clone())
            .with_compute_unit_price(1);
        let nonce_authority = Arc::new(Keypair::new());
        let nonce_account = Address::new_unique();
        let nonce_hash = Hash::new_unique();
        if nonce {
            // Only inspect construction: one nonce cannot execute multiple writes.
            token = token.with_nonce(&nonce_account, nonce_authority.clone(), &nonce_hash);
        }
        if memo {
            token.with_memo("m".repeat(300), vec![authority.pubkey()]);
        }
        let responses = token
            .confidential_transfer_create_record_account(
                &record.pubkey(),
                &authority.pubkey(),
                &proof,
                &record,
                &authority,
            )
            .await
            .unwrap();
        assert!(responses.len() > 1);
        let transactions = assert_record_bytes(
            responses,
            bytes_of(&proof),
            &payer.pubkey(),
            &record.pubkey(),
            &authority.pubkey(),
        );
        let simulations = client.simulations.lock().unwrap();
        assert_eq!(
            simulations.len(),
            if matches!(limit, ComputeUnitLimit::Simulated) {
                transactions.len()
            } else {
                0
            }
        );
        for (index, transaction) in transactions.iter().enumerate() {
            let price_instruction = ComputeBudgetInstruction::set_compute_unit_price(1);
            let budget_instructions: Vec<_> = transaction
                .message
                .instructions
                .iter()
                .filter(|instruction| {
                    transaction.message.account_keys[usize::from(instruction.program_id_index)]
                        == price_instruction.program_id
                })
                .map(|instruction| instruction.data.clone())
                .collect();
            let mut expected_budget = vec![price_instruction.data];
            if !matches!(limit, ComputeUnitLimit::Default) {
                expected_budget
                    .push(ComputeBudgetInstruction::set_compute_unit_limit(200_000).data);
            }
            assert_eq!(budget_instructions, expected_budget);

            if matches!(limit, ComputeUnitLimit::Simulated) {
                let simulation = &simulations[index];
                assert!(bincode::serialized_size(simulation).unwrap() <= PACKET_DATA_SIZE as u64);
                let mut simulated_message = simulation.message.clone();
                assert_eq!(
                    simulated_message.instructions.last().unwrap().data,
                    ComputeBudgetInstruction::set_compute_unit_limit(1_400_000).data
                );
                simulated_message.instructions.last_mut().unwrap().data =
                    ComputeBudgetInstruction::set_compute_unit_limit(200_000).data;
                assert_eq!(simulated_message, transaction.message);
            }

            let memo_count = transaction
                .message
                .instructions
                .iter()
                .filter(|instruction| {
                    transaction.message.account_keys[usize::from(instruction.program_id_index)]
                        == spl_memo_interface::v4::id()
                })
                .count();
            assert_eq!(memo_count, usize::from(memo && index == 0));
            if nonce {
                assert_eq!(transaction.message.recent_blockhash, nonce_hash);
                assert_eq!(
                    transaction.message.instructions[0].data,
                    system_instruction::advance_nonce_account(
                        &nonce_account,
                        &nonce_authority.pubkey()
                    )
                    .data
                );
            }
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct ShortProof {
    body: [u8; 512],
    tail: [u8; 128],
    middle: [u8; 32],
    end: [u8; 16],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct LargeProof {
    body: [u8; 1024],
}

// Record storage treats proof bytes as opaque; cryptographic verification is
// performed later. These proof-shaped fixtures isolate the record write sizes.
impl ZkProofData<u8> for ShortProof {
    const PROOF_TYPE: ProofType = ProofType::PubkeyValidity;

    fn context_data(&self) -> &u8 {
        &self.body[0]
    }
}

impl ZkProofData<u8> for LargeProof {
    const PROOF_TYPE: ProofType = ProofType::PubkeyValidity;

    fn context_data(&self) -> &u8 {
        &self.body[0]
    }
}

#[tokio::test]
async fn short_proof_does_not_split_at_account_allocation_size() {
    // 688 proof bytes fit in one write. Adding the record's account header to
    // the old, default-payer capacity comparison incorrectly attempted a split
    // beyond these bytes.
    let proof = ShortProof::zeroed();
    let payer = Arc::new(Keypair::new());
    let authority = Keypair::new();
    let record = Keypair::new();
    let (token, _) = token(payer.clone());
    let responses = token
        .confidential_transfer_create_record_account(
            &record.pubkey(),
            &authority.pubkey(),
            &proof,
            &record,
            &authority,
        )
        .await
        .unwrap();
    assert_eq!(responses.len(), 1);
    assert_record_bytes(
        responses,
        bytes_of(&proof),
        &payer.pubkey(),
        &record.pubkey(),
        &authority.pubkey(),
    );
}

#[tokio::test]
async fn record_chunks_fit_when_payer_is_record_authority() {
    let proof = LargeProof { body: [7_u8; 1024] };
    let payer = Arc::new(Keypair::new());
    let record = Keypair::new();
    let (token, _) = token(payer.clone());
    let responses = token
        .confidential_transfer_create_record_account(
            &record.pubkey(),
            &payer.pubkey(),
            &proof,
            &record,
            payer.as_ref(),
        )
        .await
        .unwrap();
    let transactions = assert_record_bytes(
        responses,
        bytes_of(&proof),
        &payer.pubkey(),
        &record.pubkey(),
        &payer.pubkey(),
    );
    assert_eq!(transactions[0].signatures.len(), 2);
    for transaction in &transactions[1..] {
        assert_eq!(transaction.signatures.len(), 1);
    }
}

#[tokio::test]
async fn record_creation_rejects_no_payload_capacity_before_sending() {
    let payer = Arc::new(Keypair::new());
    let authority = Keypair::new();
    let record = Keypair::new();
    let (token, client) = token(payer);
    token.with_memo("m".repeat(PACKET_DATA_SIZE), vec![authority.pubkey()]);
    let error = token
        .confidential_transfer_create_record_account(
            &record.pubkey(),
            &authority.pubkey(),
            &ShortProof::zeroed(),
            &record,
            &authority,
        )
        .await
        .unwrap_err();
    assert!(error
        .to_string()
        .contains("Proof record transaction is too large"));
    assert_eq!(client.sent.load(Ordering::Relaxed), 0);
}

#[tokio::test]
async fn record_creation_rejects_missing_memo_signer_before_sending() {
    let payer = Arc::new(Keypair::new());
    let authority = Keypair::new();
    let record = Keypair::new();
    let (token, client) = token(payer);
    let token = token.with_compute_unit_limit(ComputeUnitLimit::Simulated);
    token.with_memo("proof record", vec![Address::new_unique()]);
    let error = token
        .confidential_transfer_create_record_account(
            &record.pubkey(),
            &authority.pubkey(),
            &ShortProof::zeroed(),
            &record,
            &authority,
        )
        .await
        .unwrap_err();
    assert!(matches!(error, TokenError::MissingMemoSigner));
    assert_eq!(client.sent.load(Ordering::Relaxed), 0);
    assert!(client.simulations.lock().unwrap().is_empty());
}
