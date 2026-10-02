use {
    crate::clap_app::Error,
    async_trait::async_trait,
    serde::Serialize,
    solana_cli_output::{QuietDisplay, VerboseDisplay},
    solana_sdk::{account::Account, hash::Hash, pubkey::Pubkey, transaction::Transaction},
    spl_token_client::client::{
        ProgramClient, ProgramClientResult, ProgramRpcClientSendTransaction, RpcClientResponse,
    },
    std::{
        fmt,
        sync::{Arc, Mutex},
    },
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
enum TransactionStatus {
    Confirmed,
    Unknown,
}

#[derive(Clone, Serialize)]
struct ReportedTransaction {
    signature: String,
    status: TransactionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// Transaction outcomes recorded before a confidential CLI command failed.
/// An unknown outcome does not establish whether the transaction was submitted
/// or confirmed, including when another parallel operation canceled its future.
#[derive(Serialize)]
pub struct ConfidentialTransactionError {
    error: String,
    transactions: Vec<ReportedTransaction>,
    #[serde(skip)]
    source: Error,
}

impl fmt::Display for ConfidentialTransactionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "Error: {}", self.error)?;
        for transaction in &self.transactions {
            let status = match transaction.status {
                TransactionStatus::Confirmed => "Confirmed",
                TransactionStatus::Unknown => "Unknown",
            };
            writeln!(f, "{}: {}", status, transaction.signature)?;
            if let Some(error) = &transaction.error {
                writeln!(f, "  {}", error)?;
            }
        }
        if self
            .transactions
            .iter()
            .any(|tx| matches!(tx.status, TransactionStatus::Unknown))
        {
            writeln!(
                f,
                "Unknown transactions may or may not have been submitted or confirmed."
            )?;
        }
        Ok(())
    }
}

impl fmt::Debug for ConfidentialTransactionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Debug::fmt(&self.source, f)
    }
}

impl std::error::Error for ConfidentialTransactionError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(self.source.as_ref())
    }
}

impl QuietDisplay for ConfidentialTransactionError {}
impl VerboseDisplay for ConfidentialTransactionError {}

pub(crate) struct ReportingClient {
    inner: Arc<dyn ProgramClient<ProgramRpcClientSendTransaction> + Send + Sync>,
    transactions: Mutex<Vec<ReportedTransaction>>,
}

impl ReportingClient {
    pub(crate) fn new(
        inner: Arc<dyn ProgramClient<ProgramRpcClientSendTransaction> + Send + Sync>,
    ) -> Self {
        Self {
            inner,
            transactions: Mutex::new(Vec::new()),
        }
    }

    pub(crate) fn report_error(&self, source: Error) -> Error {
        let transactions = self.transactions.lock().unwrap().clone();
        if transactions.is_empty() {
            source
        } else {
            Box::new(ConfidentialTransactionError {
                error: source.to_string(),
                transactions,
                source,
            })
        }
    }
}

#[async_trait]
impl ProgramClient<ProgramRpcClientSendTransaction> for ReportingClient {
    async fn get_minimum_balance_for_rent_exemption(
        &self,
        data_len: usize,
    ) -> ProgramClientResult<u64> {
        self.inner
            .get_minimum_balance_for_rent_exemption(data_len)
            .await
    }

    async fn get_latest_blockhash(&self) -> ProgramClientResult<Hash> {
        self.inner.get_latest_blockhash().await
    }

    async fn get_account(&self, address: Pubkey) -> ProgramClientResult<Option<Account>> {
        self.inner.get_account(address).await
    }

    async fn simulate_transaction(
        &self,
        transaction: &Transaction,
    ) -> ProgramClientResult<RpcClientResponse> {
        self.inner.simulate_transaction(transaction).await
    }

    async fn send_transaction(
        &self,
        transaction: &Transaction,
    ) -> ProgramClientResult<RpcClientResponse> {
        // Record before awaiting: try_join! can cancel this future after submission
        // when a sibling fails, and an RPC error does not imply an on-chain failure.
        let index = if let Some(signature) = transaction
            .signatures
            .first()
            .filter(|_| transaction.is_signed())
        {
            let mut transactions = self.transactions.lock().unwrap();
            let index = transactions.len();
            transactions.push(ReportedTransaction {
                signature: signature.to_string(),
                status: TransactionStatus::Unknown,
                error: None,
            });
            Some(index)
        } else {
            None
        };
        let result = self.inner.send_transaction(transaction).await;
        if let Some(index) = index {
            let mut transactions = self.transactions.lock().unwrap();
            match &result {
                Ok(RpcClientResponse::Signature(signature)) => {
                    transactions[index].signature = signature.to_string();
                    transactions[index].status = TransactionStatus::Confirmed;
                }
                Err(error) => transactions[index].error = Some(error.to_string()),
                _ => {}
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use {
        super::*,
        solana_cli_output::OutputFormat,
        solana_sdk::signature::{Keypair, Signer},
        solana_zk_sdk::{
            encryption::pedersen::Pedersen,
            zk_elgamal_proof_program::build_batched_range_proof_u128_data,
        },
        spl_token_client::token::{ComputeUnitLimit, Token},
        std::{
            future::pending,
            sync::atomic::{AtomicUsize, Ordering},
        },
    };

    struct TestClient {
        sends: AtomicUsize,
        fail_at: usize,
        pending_at: Option<usize>,
    }

    #[async_trait]
    impl ProgramClient<ProgramRpcClientSendTransaction> for TestClient {
        async fn get_minimum_balance_for_rent_exemption(
            &self,
            _: usize,
        ) -> ProgramClientResult<u64> {
            Ok(1_000_000)
        }

        async fn get_latest_blockhash(&self) -> ProgramClientResult<Hash> {
            Ok(Hash::new_unique())
        }

        async fn get_account(&self, _: Pubkey) -> ProgramClientResult<Option<Account>> {
            Ok(None)
        }

        async fn simulate_transaction(
            &self,
            _: &Transaction,
        ) -> ProgramClientResult<RpcClientResponse> {
            Err("unexpected simulation".into())
        }

        async fn send_transaction(
            &self,
            transaction: &Transaction,
        ) -> ProgramClientResult<RpcClientResponse> {
            let index = self.sends.fetch_add(1, Ordering::Relaxed);
            if Some(index) == self.pending_at {
                return pending().await;
            }
            if index == self.fail_at {
                return Err("confirmation failed".into());
            }
            Ok(RpcClientResponse::Signature(transaction.signatures[0]))
        }
    }

    fn client(fail_at: usize, pending_at: Option<usize>) -> Arc<ReportingClient> {
        Arc::new(ReportingClient::new(Arc::new(TestClient {
            sends: AtomicUsize::new(0),
            fail_at,
            pending_at,
        })))
    }

    fn transaction(payer: &Keypair) -> Transaction {
        Transaction::new_signed_with_payer(&[], Some(&payer.pubkey()), &[payer], Hash::new_unique())
    }

    #[tokio::test]
    async fn preserves_confirmed_signatures_and_json_on_error() {
        let client = client(2, None);
        let payer = Keypair::new();
        let first = transaction(&payer);
        let second = transaction(&payer);
        let failed = transaction(&payer);
        for transaction in [&first, &second] {
            assert_eq!(
                client.send_transaction(transaction).await.unwrap(),
                RpcClientResponse::Signature(transaction.signatures[0]),
            );
        }
        let error = client.send_transaction(&failed).await.unwrap_err();
        let error = client.report_error(error);
        let report = error
            .downcast_ref::<ConfidentialTransactionError>()
            .unwrap();
        for format in [OutputFormat::Json, OutputFormat::JsonCompact] {
            let value: serde_json::Value =
                serde_json::from_str(&format.formatted_string(report)).unwrap();
            assert_eq!(value["error"], "confirmation failed");
            assert_eq!(value["transactions"].as_array().unwrap().len(), 3);
            assert_eq!(
                value["transactions"][0]["signature"],
                first.signatures[0].to_string()
            );
            assert_eq!(
                value["transactions"][1]["signature"],
                second.signatures[0].to_string()
            );
            assert_eq!(value["transactions"][0]["status"], "confirmed");
            assert_eq!(value["transactions"][1]["status"], "confirmed");
            assert_eq!(
                value["transactions"][2]["signature"],
                failed.signatures[0].to_string()
            );
            assert_eq!(value["transactions"][2]["status"], "unknown");
            assert_eq!(value["transactions"][2]["error"], "confirmation failed");
        }
        let display = OutputFormat::Display.formatted_string(report);
        assert!(display.contains(&format!("Confirmed: {}", first.signatures[0])));
        assert!(display.contains(&format!("Unknown: {}", failed.signatures[0])));
    }

    #[tokio::test]
    async fn preserves_unknown_signature_when_parallel_send_is_cancelled() {
        let client = client(2, Some(1));
        let payer = Keypair::new();
        client.send_transaction(&transaction(&payer)).await.unwrap();
        let cancelled = transaction(&payer);
        let failed = transaction(&payer);
        let error = futures::try_join!(
            client.send_transaction(&cancelled),
            client.send_transaction(&failed),
        )
        .unwrap_err();
        let error = client.report_error(error);
        let report = error
            .downcast_ref::<ConfidentialTransactionError>()
            .unwrap();
        let value = serde_json::to_value(report).unwrap();
        assert_eq!(value["transactions"].as_array().unwrap().len(), 3);
        assert_eq!(value["transactions"][0]["status"], "confirmed");
        assert_eq!(
            value["transactions"][1]["signature"],
            cancelled.signatures[0].to_string()
        );
        assert_eq!(value["transactions"][1]["status"], "unknown");
        assert!(value["transactions"][1].get("error").is_none());
        assert_eq!(value["transactions"][2]["error"], "confirmation failed");
    }

    #[tokio::test]
    async fn preserves_record_creation_when_a_later_proof_write_fails() {
        let client = client(1, None);
        let payer = Arc::new(Keypair::new());
        let token = Token::new(
            client.clone(),
            &spl_token_2022_interface::id(),
            &Pubkey::new_unique(),
            None,
            payer.clone(),
        )
        .with_compute_unit_limit(ComputeUnitLimit::Default);
        let (commitment, opening) = Pedersen::new(42_u64);
        let proof = build_batched_range_proof_u128_data(
            vec![&commitment, &commitment],
            vec![42, 42],
            vec![64, 64],
            vec![&opening, &opening],
        )
        .unwrap();
        let record = Keypair::new();
        let error = token
            .confidential_transfer_create_record_account(
                &record.pubkey(),
                &payer.pubkey(),
                &proof,
                &record,
                payer.as_ref(),
            )
            .await
            .unwrap_err();
        let error = client.report_error(error.into());
        let report = error
            .downcast_ref::<ConfidentialTransactionError>()
            .unwrap();
        let value = serde_json::to_value(report).unwrap();
        assert_eq!(value["transactions"].as_array().unwrap().len(), 2);
        assert_eq!(value["transactions"][0]["status"], "confirmed");
        assert_eq!(value["transactions"][1]["status"], "unknown");
        assert_eq!(value["transactions"][1]["error"], "confirmation failed");
    }

    #[tokio::test]
    async fn does_not_wrap_errors_without_signed_transactions() {
        let client = client(0, None);
        let error = client
            .send_transaction(&Transaction::default())
            .await
            .unwrap_err();
        let error = client.report_error(error);
        assert!(error
            .downcast_ref::<ConfidentialTransactionError>()
            .is_none());
        assert_eq!(error.to_string(), "confirmation failed");
    }
}
