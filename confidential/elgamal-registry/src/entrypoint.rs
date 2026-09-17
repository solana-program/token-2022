//! Program entrypoint

#![cfg(all(target_os = "solana", not(feature = "no-entrypoint")))]

use {
    pinocchio::AccountView, solana_address::Address, solana_program_error::ProgramResult,
    solana_security_txt::security_txt,
};

pinocchio::entrypoint!(process_instruction);
fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    crate::processor::process_instruction(program_id, accounts, instruction_data)
}

security_txt! {
    // Required fields
    name: "SPL ElGamal Registry",
    project_url: "https://solana-program.com",
    contacts: "link:https://github.com/solana-program/token-2022/security/advisories/new,mailto:security@anza.xyz,discord:https://solana.com/discord",
    policy: "https://github.com/solana-program/token-2022/blob/master/SECURITY.md",

    // Optional Fields
    preferred_languages: "en",
    source_code: "https://github.com/solana-program/token-2022/tree/master/confidential/elgamal-registry"
}
