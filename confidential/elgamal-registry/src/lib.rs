mod entrypoint;
pub mod instruction;
pub mod processor;
pub mod state;

pub use spl_elgamal_registry_interface::{
    check_id, get_elgamal_registry_address, get_elgamal_registry_address_and_bump_seed, id, ID,
    REGISTRY_ADDRESS_SEED,
};
