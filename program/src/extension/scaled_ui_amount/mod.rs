/// Scaled UI amount extension instructions
pub mod instruction;

/// Scaled UI amount extension processor
pub mod processor;

#[deprecated(
    since = "9.1.0",
    note = "Use spl_token_2022_interface instead and remove spl_token_2022 as a dependency"
)]
pub use spl_token_2022_interface::extension::scaled_ui_amount::{
    PodF64, ScaledUiAmountConfig, UnixTimestamp,
};
