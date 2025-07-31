/// Instruction types for the pausable extension
pub mod instruction;
/// Instruction processor for the pausable extension
pub mod processor;

pub use spl_token_2022_interface::extension::pausable::{
    PausableConfig, PausableAccount,
};
