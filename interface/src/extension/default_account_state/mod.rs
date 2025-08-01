#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};
use {
    crate::extension::{Extension, ExtensionType},
    bytemuck::{Pod, Zeroable},
};

/// Default Account state extension instructions
pub mod instruction;

/// Default Account::state extension data for mints.
#[repr(C)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct DefaultAccountState {
    /// Default Account::state in which new Accounts should be initialized
    pub state: PodAccountState,
}
impl Extension for DefaultAccountState {
    const TYPE: ExtensionType = ExtensionType::DefaultAccountState;
}

type PodAccountState = u8;
