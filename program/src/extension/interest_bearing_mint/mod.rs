/// Interest-bearing mint extension instructions
pub mod instruction;

/// Interest-bearing mint extension processor
pub mod processor;

pub use spl_token_2022_interface::extension::interest_bearing_mint::{
    BasisPoints, InterestBearingConfig, UnixTimestamp,
};
