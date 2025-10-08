/// Interest-bearing mint extension instructions
pub mod instruction;

/// Interest-bearing mint extension processor
pub mod processor;

#[deprecated(
    since = "9.1.0",
    note = "Use spl_token_2022_interface instead and remove spl_token_2022 as a dependency"
)]
pub use spl_token_2022_interface::extension::interest_bearing_mint::{
    BasisPoints, InterestBearingConfig, UnixTimestamp,
};
