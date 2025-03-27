//! Program entrypoint

#![cfg(all(target_os = "solana", not(feature = "no-entrypoint")))]

use {
    solana_account_info::AccountInfo, solana_program_error::ProgramResult, solana_pubkey::Pubkey,
    solana_security_txt::security_txt,
};

solana_program_entrypoint::entrypoint!(process_instruction);
fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    crate::processor::process_instruction(program_id, accounts, instruction_data)
}

security_txt! {
    // Required fields
    name: "SPL Record",
    project_url: "https://solana-program.com/record",
    contacts: "link:https://github.com/solana-program/record/security/advisories/new,mailto:security@anza.xyz,discord:https://solana.com/discord",
    policy: "https://github.com/solana-program/record/blob/master/SECURITY.md",

    // Optional Fields
    preferred_languages: "en",
    source_code: "https://github.com/solana-program/record/tree/master/program"
}
