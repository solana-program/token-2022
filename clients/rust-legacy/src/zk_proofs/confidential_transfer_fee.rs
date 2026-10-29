use {
    solana_zk_elgamal_proof_interface::proof_data::ciphertext_ciphertext_equality::CiphertextCiphertextEqualityProofData,
    solana_zk_sdk::{
        encryption::{
            elgamal::{ElGamalCiphertext, ElGamalKeypair, ElGamalPubkey},
            pedersen::PedersenOpening,
        },
        zk_elgamal_proof_program::build_ciphertext_ciphertext_equality_proof_data,
    },
    spl_token_2022_interface::{
        error::TokenError, extension::confidential_transfer_fee::EncryptedWithheldAmount,
    },
};

/// Confidential transfer fee extension information needed to construct a
/// `WithdrawWithheldTokensFromMint` or `WithdrawWithheldTokensFromAccounts`
/// instruction.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct WithheldTokensInfo {
    /// The available balance
    pub(crate) withheld_amount: EncryptedWithheldAmount,
}
impl WithheldTokensInfo {
    /// Create a `WithheldTokensInfo` from an ElGamal ciphertext.
    pub fn new(withheld_amount: &EncryptedWithheldAmount) -> Self {
        Self {
            withheld_amount: *withheld_amount,
        }
    }

    /// Create withdraw withheld proof data, recovering the amount with `decrypt_u32`.
    ///
    /// To supply a known amount, use [`Self::generate_proof_data_with_amount`].
    pub fn generate_proof_data(
        &self,
        withdraw_withheld_authority_elgamal_keypair: &ElGamalKeypair,
        destination_elgamal_pubkey: &ElGamalPubkey,
    ) -> Result<CiphertextCiphertextEqualityProofData, TokenError> {
        self.generate_proof_data_inner(
            withdraw_withheld_authority_elgamal_keypair,
            destination_elgamal_pubkey,
            None,
        )
    }

    /// Create withdraw withheld proof data using a known amount in base units.
    /// The amount is validated against the withheld ciphertext and authority key.
    pub fn generate_proof_data_with_amount(
        &self,
        withdraw_withheld_authority_elgamal_keypair: &ElGamalKeypair,
        destination_elgamal_pubkey: &ElGamalPubkey,
        known_amount: u64,
    ) -> Result<CiphertextCiphertextEqualityProofData, TokenError> {
        self.generate_proof_data_inner(
            withdraw_withheld_authority_elgamal_keypair,
            destination_elgamal_pubkey,
            Some(known_amount),
        )
    }

    pub(crate) fn generate_proof_data_inner(
        &self,
        withdraw_withheld_authority_elgamal_keypair: &ElGamalKeypair,
        destination_elgamal_pubkey: &ElGamalPubkey,
        known_amount: Option<u64>,
    ) -> Result<CiphertextCiphertextEqualityProofData, TokenError> {
        let withheld_amount_in_mint: ElGamalCiphertext = self
            .withheld_amount
            .try_into()
            .map_err(|_| TokenError::MalformedCiphertext)?;

        let decrypted_withheld_amount_in_mint = match known_amount {
            Some(amount) => amount,
            None => withheld_amount_in_mint
                .decrypt_u32(withdraw_withheld_authority_elgamal_keypair.secret())
                .ok_or(TokenError::AccountDecryption)?,
        };

        let destination_opening = PedersenOpening::new_rand();

        let destination_ciphertext = destination_elgamal_pubkey
            .encrypt_with(decrypted_withheld_amount_in_mint, &destination_opening);

        build_ciphertext_ciphertext_equality_proof_data(
            withdraw_withheld_authority_elgamal_keypair,
            destination_elgamal_pubkey,
            &withheld_amount_in_mint,
            &destination_ciphertext,
            &destination_opening,
            decrypted_withheld_amount_in_mint,
        )
        .map_err(|_| TokenError::ProofGeneration)
    }
}

#[cfg(test)]
mod tests {
    use {
        super::*,
        crate::{
            client::{ProgramOfflineClient, ProgramRpcClientSendTransaction, RpcClientResponse},
            token::{ComputeUnitLimit, Token, TokenError as TokenClientError},
        },
        solana_address::Address,
        solana_hash::Hash,
        solana_sdk::signer::{keypair::Keypair, Signer},
        solana_zk_sdk::{
            encryption::auth_encryption::AeKey, zk_elgamal_proof_program::VerifyZkProof,
        },
        std::sync::Arc,
        test_case::test_case,
    };

    #[test_case(55, None; "decrypt_u32")]
    #[test_case(55, Some(55); "known_amount")]
    #[test_case(u64::from(u32::MAX) + 1, Some(u64::from(u32::MAX) + 1); "above_u32_max")]
    #[test_case(u64::MAX, Some(u64::MAX); "u64_max")]
    #[test_case(0, Some(0); "zero")]
    fn withheld_proof(amount: u64, known_amount: Option<u64>) {
        let authority = ElGamalKeypair::new_rand();
        let destination = ElGamalKeypair::new_rand();
        let withheld = authority.pubkey().encrypt(amount);
        let info = WithheldTokensInfo::new(&withheld.into());
        let generate_proof = || match known_amount {
            Some(amount) => {
                info.generate_proof_data_with_amount(&authority, destination.pubkey(), amount)
            }
            None => info.generate_proof_data(&authority, destination.pubkey()),
        };
        let proof = generate_proof().unwrap();
        proof.verify_proof().unwrap();
        assert_eq!(proof.context.first_ciphertext, withheld.into());
        let destination_ciphertext: ElGamalCiphertext =
            proof.context.second_ciphertext.try_into().unwrap();
        assert_eq!(
            destination_ciphertext.decrypt(destination.secret()).target,
            withheld.decrypt(authority.secret()).target,
        );
        let second_proof = generate_proof().unwrap();
        second_proof.verify_proof().unwrap();
        assert_ne!(
            proof.context.second_ciphertext,
            second_proof.context.second_ciphertext,
        );
    }

    #[test]
    fn legacy_withheld_proof_remains_bounded() {
        let authority = ElGamalKeypair::new_rand();
        let destination = ElGamalKeypair::new_rand();
        let amount = u64::from(u32::MAX) + 1;
        let info = WithheldTokensInfo::new(&authority.pubkey().encrypt(amount).into());
        assert_eq!(
            info.generate_proof_data(&authority, destination.pubkey()),
            Err(TokenError::AccountDecryption),
        );
    }

    #[test]
    fn withheld_proof_rejects_mismatched_amount_and_authority() {
        let authority = ElGamalKeypair::new_rand();
        let destination = ElGamalKeypair::new_rand();
        let info = WithheldTokensInfo::new(&authority.pubkey().encrypt(55_u64).into());
        assert_eq!(
            info.generate_proof_data_with_amount(&authority, destination.pubkey(), 54),
            Err(TokenError::ProofGeneration),
        );
        assert_eq!(
            info.generate_proof_data_with_amount(&destination, destination.pubkey(), 55),
            Err(TokenError::ProofGeneration),
        );
    }

    #[test_case(true, false; "mint_inline")]
    #[test_case(false, false; "accounts_inline")]
    #[test_case(true, true; "mint_context")]
    #[test_case(false, true; "accounts_context")]
    #[tokio::test]
    async fn known_amount_is_validated_before_transaction_output(
        from_mint: bool,
        use_context: bool,
    ) {
        let payer = Arc::new(Keypair::new());
        let mint = Address::new_unique();
        let destination = Address::new_unique();
        let source = Address::new_unique();
        let context = use_context.then(Address::new_unique);
        let client = Arc::new(ProgramOfflineClient::new(
            Hash::new_unique(),
            ProgramRpcClientSendTransaction,
        ));
        let token = Token::new(
            client,
            &spl_token_2022_interface::id(),
            &mint,
            None,
            payer.clone(),
        )
        .with_compute_unit_limit(ComputeUnitLimit::Static(200_000));
        let authority = ElGamalKeypair::new_rand();
        let destination_keypair = ElGamalKeypair::new_rand();
        let amount = u64::from(u32::MAX) + 1;
        let info = WithheldTokensInfo::new(&authority.pubkey().encrypt(amount).into());
        let balance = AeKey::new_rand().encrypt(amount).into();
        for known_amount in [amount - 1, amount] {
            let result = if from_mint {
                token
                    .confidential_transfer_withdraw_withheld_tokens_from_mint_with_amount(
                        &destination,
                        &payer.pubkey(),
                        context.as_ref(),
                        Some(info),
                        known_amount,
                        &authority,
                        destination_keypair.pubkey(),
                        &balance,
                        &[payer.as_ref()],
                    )
                    .await
            } else {
                token
                    .confidential_transfer_withdraw_withheld_tokens_from_accounts_with_amount(
                        &destination,
                        &payer.pubkey(),
                        context.as_ref(),
                        Some(info),
                        known_amount,
                        &authority,
                        destination_keypair.pubkey(),
                        &balance,
                        &[&source],
                        &[payer.as_ref()],
                    )
                    .await
            };
            if known_amount == amount {
                let RpcClientResponse::Transaction(transaction) = result.unwrap() else {
                    panic!("Expected transaction output");
                };
                let has_inline_proof = transaction.message.instructions.iter().any(|instruction| {
                    transaction.message.account_keys[usize::from(instruction.program_id_index)]
                        == solana_zk_elgamal_proof_interface::id()
                });
                assert_eq!(has_inline_proof, !use_context);
            } else {
                assert_eq!(result.unwrap_err(), TokenClientError::ProofGeneration);
            }
        }
    }
}
