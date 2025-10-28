mod entrypoint;
pub mod instruction;
pub mod processor;
pub mod state;

pub use spl_elgamal_registry_interface::{
    REGISTRY_ADDRESS_SEED, get_elgamal_registry_address_and_bump_seed,
    get_elgamal_registry_address, id, ID, check_id
};
