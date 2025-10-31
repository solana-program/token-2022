#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};
use {
    crate::extension::{Extension, ExtensionType},
    bytemuck::{Pod, Zeroable},
    spl_pod::{optional_keys::OptionalNonZeroPubkey, primitives::PodBool},
};

/// Instruction types for the permissioned burn extension
pub mod instruction;

/// Indicates that the tokens from this mint require permissioned burn
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub struct PermissionedBurnConfig {
    /// Authority that is required for burning
    pub authority: OptionalNonZeroPubkey,
    /// Whether permission from the authority is required to burn
    pub enabled: PodBool,
}

/// Indicates that the tokens from this account belong to a permissioned burn mint
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
#[repr(transparent)]
pub struct PermissionedBurnAccount;

impl Extension for PermissionedBurnConfig {
    const TYPE: ExtensionType = ExtensionType::PermissionedBurn;
}

impl Extension for PermissionedBurnAccount {
    const TYPE: ExtensionType = ExtensionType::PermissionedBurn;
}
