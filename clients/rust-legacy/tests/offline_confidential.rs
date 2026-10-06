use {
    bytemuck::bytes_of,
    solana_address::Address,
    solana_hash::Hash,
    solana_instruction::AccountMeta,
    solana_packet::PACKET_DATA_SIZE,
    solana_sdk::signer::{keypair::Keypair, null_signer::NullSigner},
    solana_signature::Signature,
    solana_signer::Signer,
    solana_system_interface::instruction as system_instruction,
    solana_transaction::Transaction,
    solana_zk_elgamal_proof_interface::{
        proof_data::{BatchedRangeProofContext, BatchedRangeProofU64Data},
        state::ProofContextState,
    },
    solana_zk_sdk::{
        encryption::{auth_encryption::AeKey, elgamal::ElGamalKeypair},
        zk_elgamal_proof_program::build_pubkey_validity_proof_data,
    },
    spl_token_2022_interface::error::TokenError,
    spl_token_client::{
        client::{ProgramOfflineClient, ProgramRpcClientSendTransaction, RpcClientResponse},
        token::{ComputeUnitLimit, ProofAccountWithCiphertext, Token},
        zk_proofs::confidential_transfer::{
            ApplyPendingBalanceAccountInfo, TransferAccountInfo, WithdrawAccountInfo,
        },
    },
    std::{mem::size_of, sync::Arc},
};

fn transaction(response: RpcClientResponse) -> Transaction {
    match response {
        RpcClientResponse::Transaction(transaction) => transaction,
        _ => panic!("offline client must return a transaction"),
    }
}

fn assert_signature(transaction: &Transaction, signer: &dyn Signer) {
    let index = transaction
        .message
        .account_keys
        .iter()
        .position(|key| key == &signer.pubkey())
        .unwrap();
    assert_eq!(
        transaction.signatures[index],
        signer.sign_message(&transaction.message_data())
    );
}

#[tokio::test]
async fn offline_proof_accounts_preserve_rent_messages_and_temporary_signatures() {
    let blockhash = Hash::new_unique();
    let payer = Address::new_unique();
    let client = Arc::new(ProgramOfflineClient::new(
        blockhash,
        ProgramRpcClientSendTransaction,
    ));
    let token = Token::new(
        client,
        &spl_token_2022_interface::id(),
        &Address::new_unique(),
        Some(0),
        Arc::new(NullSigner::new(&payer)),
    )
    .with_proof_account_lamports(25_000_000)
    .with_compute_unit_price(1)
    .with_compute_unit_limit(ComputeUnitLimit::Static(200_000));
    let authority = Keypair::new();
    let record = Keypair::new();
    let context = Keypair::new();
    let elgamal_keypair = ElGamalKeypair::new_rand();
    let aes_key = AeKey::new_rand();
    let account_info = WithdrawAccountInfo {
        available_balance: elgamal_keypair.pubkey().encrypt(42_u64).into(),
        decryptable_available_balance: aes_key.encrypt(42).into(),
    };
    let proof_data = account_info
        .generate_proof_data(2, &elgamal_keypair, &aes_key)
        .unwrap()
        .range_proof_data;
    let proof_bytes = bytes_of(&proof_data);
    let responses = token
        .confidential_transfer_create_record_account(
            &record.pubkey(),
            &authority.pubkey(),
            &proof_data,
            &record,
            &authority,
        )
        .await
        .unwrap();
    assert!(responses.len() > 1);
    let mut offset = 0_usize;
    for (index, response) in responses.into_iter().enumerate() {
        let transaction = transaction(response);
        assert_eq!(transaction.message.recent_blockhash, blockhash);
        assert_eq!(transaction.message.account_keys[0], payer);
        assert_eq!(transaction.signatures[0], Signature::default());
        assert_signature(&transaction, &authority);
        if index == 0 {
            assert_signature(&transaction, &record);
            let create = system_instruction::create_account(
                &payer,
                &record.pubkey(),
                25_000_000,
                proof_bytes
                    .len()
                    .checked_add(spl_record::state::RecordData::WRITABLE_START_INDEX)
                    .unwrap() as u64,
                &spl_record::id(),
            );
            assert_eq!(transaction.message.instructions[0].data, create.data);
        }
        assert!(bincode::serialized_size(&transaction).unwrap() <= PACKET_DATA_SIZE as u64);
        let empty_write = spl_record::instruction::write(
            &record.pubkey(),
            &authority.pubkey(),
            offset as u64,
            &[],
        );
        let write = transaction
            .message
            .instructions
            .iter()
            .find(|instruction| {
                transaction.message.account_keys[instruction.program_id_index as usize]
                    == spl_record::id()
                    && instruction.data.first() == empty_write.data.first()
            })
            .unwrap();
        let chunk_length = write
            .data
            .len()
            .checked_sub(empty_write.data.len())
            .unwrap();
        let end = offset.checked_add(chunk_length).unwrap();
        let expected_write = spl_record::instruction::write(
            &record.pubkey(),
            &authority.pubkey(),
            offset as u64,
            &proof_bytes[offset..end],
        );
        assert_eq!(write.data, expected_write.data);
        offset = end;
    }
    assert_eq!(offset, proof_bytes.len());

    let response = token
        .confidential_transfer_create_context_state_account_from_record::<
            _,
            BatchedRangeProofU64Data,
            BatchedRangeProofContext,
        >(
            &context.pubkey(),
            &authority.pubkey(),
            &record.pubkey(),
            &[&context],
        )
        .await
        .unwrap();
    let transaction = transaction(response);
    assert_signature(&transaction, &context);
    assert_eq!(transaction.signatures[0], Signature::default());
    let create = system_instruction::create_account(
        &payer,
        &context.pubkey(),
        25_000_000,
        size_of::<ProofContextState<BatchedRangeProofContext>>() as u64,
        &solana_zk_elgamal_proof_interface::id(),
    );
    assert_eq!(transaction.message.instructions[0].data, create.data);
}

#[tokio::test]
async fn offline_context_proof_requires_explicit_lamports() {
    let payer = Arc::new(Keypair::new());
    let context = Keypair::new();
    let client = Arc::new(ProgramOfflineClient::new(
        Hash::new_unique(),
        ProgramRpcClientSendTransaction,
    ));
    let token = Token::new(
        client,
        &spl_token_2022_interface::id(),
        &Address::new_unique(),
        None,
        payer.clone(),
    );
    let proof_data = build_pubkey_validity_proof_data(&ElGamalKeypair::new_rand()).unwrap();
    let error = token
        .confidential_transfer_create_context_state_account(
            &context.pubkey(),
            &payer.pubkey(),
            &proof_data,
            &[&context],
        )
        .await
        .unwrap_err();
    assert!(error.to_string().contains("rent exemption in offline mode"));
    let response = token
        .with_proof_account_lamports(2_000_000)
        .confidential_transfer_create_context_state_account(
            &context.pubkey(),
            &payer.pubkey(),
            &proof_data,
            &[&context],
        )
        .await
        .unwrap();
    let transaction = transaction(response);
    assert_signature(&transaction, payer.as_ref());
    assert_signature(&transaction, &context);
}

#[test]
fn supplied_pending_balances_report_overflow() {
    let elgamal_keypair = ElGamalKeypair::new_rand();
    let aes_key = AeKey::new_rand();
    let info = ApplyPendingBalanceAccountInfo::from_balances(
        1,
        elgamal_keypair.pubkey().encrypt(1_u64).into(),
        elgamal_keypair.pubkey().encrypt(0_u64).into(),
        aes_key.encrypt(u64::MAX).into(),
    );
    assert!(matches!(
        info.new_decryptable_available_balance(elgamal_keypair.secret(), &aes_key),
        Err(TokenError::Overflow)
    ));
}

#[tokio::test]
async fn offline_transfers_use_explicit_hook_accounts_without_fetching_state() {
    let payer = Arc::new(Keypair::new());
    let owner = Keypair::new();
    let blockhash = Hash::new_unique();
    let client = Arc::new(ProgramOfflineClient::new(
        blockhash,
        ProgramRpcClientSendTransaction,
    ));
    let extra_account = Address::new_unique();
    let token = Token::new(
        client,
        &spl_token_2022_interface::id(),
        &Address::new_unique(),
        Some(0),
        payer.clone(),
    )
    .with_transfer_hook_accounts(vec![AccountMeta::new(extra_account, false)]);
    let source = Address::new_unique();
    let destination = Address::new_unique();
    let source_elgamal_keypair = ElGamalKeypair::new_rand();
    let destination_elgamal_keypair = ElGamalKeypair::new_rand();
    let withdraw_withheld_elgamal_keypair = ElGamalKeypair::new_rand();
    let aes_key = AeKey::new_rand();
    let account_info = TransferAccountInfo {
        available_balance: source_elgamal_keypair.pubkey().encrypt(42_u64).into(),
        decryptable_available_balance: aes_key.encrypt(42).into(),
    };
    let proof_data = account_info
        .generate_split_transfer_proof_data(
            2,
            &source_elgamal_keypair,
            &aes_key,
            destination_elgamal_keypair.pubkey(),
            None,
        )
        .unwrap();
    let proof_account = ProofAccountWithCiphertext {
        context_state_account: Address::new_unique(),
        ciphertext_lo: proof_data
            .ciphertext_validity_proof_data_with_ciphertext
            .ciphertext_lo,
        ciphertext_hi: proof_data
            .ciphertext_validity_proof_data_with_ciphertext
            .ciphertext_hi,
    };
    for with_fee in [false, true] {
        let response = if with_fee {
            token
                .confidential_transfer_transfer_with_fee(
                    &source,
                    &destination,
                    &owner.pubkey(),
                    Some(&Address::new_unique()),
                    Some(&proof_account),
                    Some(&Address::new_unique()),
                    Some(&Address::new_unique()),
                    Some(&Address::new_unique()),
                    2,
                    Some(account_info),
                    &source_elgamal_keypair,
                    &aes_key,
                    destination_elgamal_keypair.pubkey(),
                    None,
                    withdraw_withheld_elgamal_keypair.pubkey(),
                    250,
                    100,
                    &[&owner],
                )
                .await
                .unwrap()
        } else {
            token
                .confidential_transfer_transfer(
                    &source,
                    &destination,
                    &owner.pubkey(),
                    Some(&Address::new_unique()),
                    Some(&proof_account),
                    Some(&Address::new_unique()),
                    2,
                    Some(account_info),
                    &source_elgamal_keypair,
                    &aes_key,
                    destination_elgamal_keypair.pubkey(),
                    None,
                    &[&owner],
                )
                .await
                .unwrap()
        };
        let transaction = transaction(response);
        assert_eq!(transaction.message.recent_blockhash, blockhash);
        assert_signature(&transaction, payer.as_ref());
        assert_signature(&transaction, &owner);
        let instruction = &transaction.message.instructions[0];
        let extra_index = *instruction.accounts.last().unwrap() as usize;
        assert_eq!(transaction.message.account_keys[extra_index], extra_account);
    }
}
