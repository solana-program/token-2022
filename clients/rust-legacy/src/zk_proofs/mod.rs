use {
    spl_token_2022_interface::error::TokenError,
    spl_token_confidential_transfer_proof_generation::errors::TokenProofGenerationError,
};

pub mod confidential_mint_burn;
pub mod confidential_transfer;
pub mod confidential_transfer_fee;

pub trait IntoTokenError {
    fn into_token_error(self) -> TokenError;
}

impl IntoTokenError for TokenProofGenerationError {
    fn into_token_error(self) -> TokenError {
        match self {
            TokenProofGenerationError::ProofGeneration(_) => TokenError::ProofGeneration,
            TokenProofGenerationError::NotEnoughFunds => TokenError::InsufficientFunds,
            TokenProofGenerationError::IllegalAmountBitLength => TokenError::IllegalBitLength,
            TokenProofGenerationError::FeeCalculation => TokenError::FeeCalculation,
            TokenProofGenerationError::CiphertextExtraction => TokenError::MalformedCiphertext,
        }
    }
}
