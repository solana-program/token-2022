/// Slot reference fee extension instructions
pub mod instruction;

/// Slot reference fee extension processor
pub mod processor;

pub use spl_token_2022_interface::extension::slot_reference_fee::{
    SlotReferenceFeeAmount, SlotReferenceFeeConfig, MAX_FEE_BASIS_POINTS,
};
