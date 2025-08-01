/// Transfer fee extension instructions
pub mod instruction;

/// Transfer fee extension processor
pub mod processor;

pub use spl_token_2022_interface::extension::transfer_fee::{
    TransferFee, TransferFeeAmount, TransferFeeConfig, MAX_FEE_BASIS_POINTS,
};
