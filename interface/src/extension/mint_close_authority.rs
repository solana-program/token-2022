use {
    crate::extension::{Extension, ExtensionType},
    bytemuck::{Pod, Zeroable},
    solana_address::Address,
    solana_nullable::MaybeNull,
};
#[cfg(feature = "serde")]
use {
    serde::{Deserialize, Serialize},
    serde_with::{As, DisplayFromStr},
};

/// Close authority extension data for mints.
#[repr(C)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct MintCloseAuthority {
    /// Optional authority to close the mint
    #[cfg_attr(feature = "serde", serde(with = "As::<Option<DisplayFromStr>>"))]
    pub close_authority: MaybeNull<Address>,
}
impl Extension for MintCloseAuthority {
    const TYPE: ExtensionType = ExtensionType::MintCloseAuthority;
}
