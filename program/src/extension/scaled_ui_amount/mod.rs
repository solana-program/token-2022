/// Scaled UI amount extension instructions
pub mod instruction;

/// Scaled UI amount extension processor
pub mod processor;

pub use spl_token_2022_interface::extension::scaled_ui_amount::{
    PodF64, ScaledUiAmountConfig, UnixTimestamp,
};
