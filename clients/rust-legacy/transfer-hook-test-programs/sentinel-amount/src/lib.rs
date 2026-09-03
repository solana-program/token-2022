//! Program implementation
//!
//! Succeeds only when the `Execute` instruction carries `u64::MAX` as the
//! amount. Token-2022 passes that sentinel when it invokes a transfer hook
//! from a confidential transfer, because the real amount is encrypted and
//! unavailable to the program.
//!
//! Used by the tests to pin that convention from the hook's point of view:
//! a confidential transfer through this hook succeeds, and a public one
//! fails, because there the hook is handed the actual amount.

use {
    solana_account_info::AccountInfo, solana_address::Address,
    solana_program_error::{ProgramError, ProgramResult},
};

/// Instruction data layout of the transfer-hook interface `Execute`:
/// an 8-byte discriminator followed by the amount as a little-endian `u64`.
const DISCRIMINATOR_LEN: usize = 8;
const AMOUNT_LEN: usize = 8;

solana_program_entrypoint::entrypoint!(process_instruction);
fn process_instruction(
    _program_id: &Address,
    _accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Anything that is not an `Execute` is out of scope for this example.
    if instruction_data.len() < DISCRIMINATOR_LEN + AMOUNT_LEN {
        return Ok(());
    }
    let amount = u64::from_le_bytes(
        instruction_data[DISCRIMINATOR_LEN..DISCRIMINATOR_LEN + AMOUNT_LEN]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    if amount == u64::MAX {
        Ok(())
    } else {
        Err(ProgramError::InvalidInstructionData)
    }
}
