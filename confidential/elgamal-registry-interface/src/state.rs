use {
    bytemuck::{Pod, Zeroable},
    solana_address::Address,
    solana_zk_sdk_pod::encryption::elgamal::PodElGamalPubkey,
};

pub const ELGAMAL_REGISTRY_ACCOUNT_LEN: usize = 64;

/// ElGamal public key registry. It contains an ElGamal public key that is
/// associated with a wallet account, but independent of any specific mint.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct ElGamalRegistry {
    /// The owner of the registry
    pub owner: Address,
    /// The ElGamal public key associated with an account
    pub elgamal_pubkey: PodElGamalPubkey,
}
