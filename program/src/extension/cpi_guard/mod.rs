/// CPI Guard extension instructions
pub mod instruction;

/// CPI Guard extension processor
pub mod processor;

#[deprecated(
    since = "9.1.0",
    note = "Use spl_token_2022_interface instead and remove spl_token_2022 as a dependency"
)]
pub use spl_token_2022_interface::extension::cpi_guard::{cpi_guard_enabled, CpiGuard};

/// Determine if we are in CPI
pub fn in_cpi() -> bool {
    #[cfg(target_os = "solana")]
    #[allow(unsafe_code)]
    unsafe {
        use solana_instruction::{syscalls::sol_get_stack_height, TRANSACTION_LEVEL_STACK_HEIGHT};
        sol_get_stack_height() as usize > TRANSACTION_LEVEL_STACK_HEIGHT
    }
    #[cfg(not(target_os = "solana"))]
    {
        false
    }
}
