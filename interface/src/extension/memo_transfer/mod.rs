#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};
use {
    crate::extension::{BaseState, BaseStateWithExtensions, Extension, ExtensionType},
    bytemuck::{Pod, Zeroable},
    spl_pod::primitives::PodBool,
};

/// Memo Transfer extension instructions
pub mod instruction;

/// Memo Transfer extension for Accounts
#[repr(C)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct MemoTransfer {
    /// Require transfers into this account to be accompanied by a memo
    pub require_incoming_transfer_memos: PodBool,
}
impl Extension for MemoTransfer {
    const TYPE: ExtensionType = ExtensionType::MemoTransfer;
}

/// Determine if a memo is required for transfers into this account
pub fn memo_required<BSE: BaseStateWithExtensions<S>, S: BaseState>(account_state: &BSE) -> bool {
    if let Ok(extension) = account_state.get_extension::<MemoTransfer>() {
        return extension.require_incoming_transfer_memos.into();
    }
    false
}
