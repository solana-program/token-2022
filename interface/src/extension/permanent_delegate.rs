use {
    crate::extension::{BaseState, BaseStateWithExtensions, Extension, ExtensionType},
    bytemuck::{Pod, Zeroable},
    solana_address::Address,
    solana_nullable::MaybeNull,
};
#[cfg(feature = "serde")]
use {
    serde::{Deserialize, Serialize},
    serde_with::{As, DisplayFromStr},
};

/// Permanent delegate extension data for mints.
#[repr(C)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct PermanentDelegate {
    /// Optional permanent delegate for transferring or burning tokens
    #[cfg_attr(feature = "serde", serde(with = "As::<Option<DisplayFromStr>>"))]
    pub delegate: MaybeNull<Address>,
}
impl Extension for PermanentDelegate {
    const TYPE: ExtensionType = ExtensionType::PermanentDelegate;
}

/// Attempts to get the permanent delegate from the TLV data, returning None
/// if the extension is not found
pub fn get_permanent_delegate<S: BaseState, BSE: BaseStateWithExtensions<S>>(
    state: &BSE,
) -> Option<Address> {
    state
        .get_extension::<PermanentDelegate>()
        .ok()
        .and_then(|e| Option::<Address>::from(e.delegate))
}
