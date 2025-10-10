/// Transfer fee extension instructions
pub mod instruction;

/// Transfer fee extension processor
pub mod processor;

#[deprecated(
    since = "9.1.0",
    note = "Use spl_token_2022_interface instead and remove spl_token_2022 as a dependency"
)]
pub use spl_token_2022_interface::extension::transfer_fee::{
    TransferFee, TransferFeeAmount, TransferFeeConfig, MAX_FEE_BASIS_POINTS,
};
