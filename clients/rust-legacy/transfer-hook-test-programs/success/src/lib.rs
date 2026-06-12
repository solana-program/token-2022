//! Program implementation

use {
    solana_account_info::AccountInfo, solana_program_error::ProgramResult, solana_address::Address,
};

solana_program_entrypoint::entrypoint!(process_instruction);
fn process_instruction(
    _program_id: &Address,
    _accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    Ok(())
}
