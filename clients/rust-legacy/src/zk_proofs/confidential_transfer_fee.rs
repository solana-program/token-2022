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
    known_amount: Option<u64>,
}
impl WithheldTokensInfo {
    /// Create a `WithheldTokensInfo` from an ElGamal ciphertext.
    pub fn new(withheld_amount: &EncryptedWithheldAmount) -> Self {
        Self {
            withheld_amount: *withheld_amount,
            known_amount: None,
        }
    }

    /// Set a known withheld amount in base units, avoiding bounded decryption.
    pub fn with_known_amount(mut self, amount: u64) -> Self {
        self.known_amount = Some(amount);
        self
    }

    /// Create withdraw withheld proof data using the known amount, if supplied.
    pub fn generate_proof_data(
        &self,
        withdraw_withheld_authority_elgamal_keypair: &ElGamalKeypair,
        destination_elgamal_pubkey: &ElGamalPubkey,
    ) -> Result<CiphertextCiphertextEqualityProofData, TokenError> {
        let withheld_amount_in_mint: ElGamalCiphertext = self
            .withheld_amount
            .try_into()
            .map_err(|_| TokenError::MalformedCiphertext)?;

        let decrypted_withheld_amount_in_mint = match self.known_amount {
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
    use {super::*, solana_zk_sdk::zk_elgamal_proof_program::VerifyZkProof, test_case::test_case};

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
        let info = if let Some(amount) = known_amount {
            info.with_known_amount(amount)
        } else {
            info
        };
        let generate_proof = || info.generate_proof_data(&authority, destination.pubkey());
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
            info.with_known_amount(54)
                .generate_proof_data(&authority, destination.pubkey()),
            Err(TokenError::ProofGeneration),
        );
        assert_eq!(
            info.with_known_amount(55)
                .generate_proof_data(&destination, destination.pubkey()),
            Err(TokenError::ProofGeneration),
        );
    }
}
