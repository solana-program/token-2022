/// Instruction types for the permissioned burn extension
pub mod instruction;
/// Instruction processor for the permissioned burn extension
pub mod processor;

#[deprecated(
    since = "9.1.0",
    note = "Use spl_token_2022_interface instead and remove spl_token_2022 as a dependency"
)]
pub use spl_token_2022_interface::extension::permissioned_burn::{PermissionedBurnAccount, PermissionedBurnConfig};
