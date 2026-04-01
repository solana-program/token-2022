use {
    crate::extension::{Extension, ExtensionType},
    bytemuck::{Pod, Zeroable},
    solana_address::Address,
    solana_nullable::MaybeNull,
    solana_zero_copy::unaligned::Bool,
};
#[cfg(feature = "serde")]
use {
    serde::{Deserialize, Serialize},
    serde_with::{As, DisplayFromStr},
};

/// Instruction types for the pausable extension
pub mod instruction;

/// Indicates that the tokens from this mint can be paused
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub struct PausableConfig {
    /// Authority that can pause or resume activity on the mint
    #[cfg_attr(feature = "serde", serde(with = "As::<Option<DisplayFromStr>>"))]
    pub authority: MaybeNull<Address>,
    /// Whether minting / transferring / burning tokens is paused
    pub paused: Bool,
}

/// Indicates that the tokens from this account belong to a pausable mint
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
#[repr(transparent)]
pub struct PausableAccount;

impl Extension for PausableConfig {
    const TYPE: ExtensionType = ExtensionType::Pausable;
}

impl Extension for PausableAccount {
    const TYPE: ExtensionType = ExtensionType::PausableAccount;
}
