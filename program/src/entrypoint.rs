//! Program entrypoint

use {
    crate::{error::TokenError, processor::Processor},
    solana_account_info::AccountInfo,
    solana_program_error::{PrintProgramError, ProgramResult},
    solana_pubkey::Pubkey,
    solana_security_txt::security_txt,
};

solana_program_entrypoint::entrypoint!(process_instruction);
fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if let Err(error) = Processor::process(program_id, accounts, instruction_data) {
        // catch the error so we can print it
        error.print::<TokenError>();
        return Err(error);
    }
    Ok(())
}

security_txt! {
    // Required fields
    name: "SPL Token-2022",
    project_url: "https://www.solana-program.com/docs/token-2022",
    contacts: "link:https://github.com/solana-program/token-2022/security/advisories/new,mailto:security@anza.xyz,discord:https://solana.com/discord",
    policy: "https://github.com/solana-program/token-2022/blob/master/SECURITY.md",

    // Optional Fields
    preferred_languages: "en",
    source_code: "https://github.com/solana-program/token-2022/tree/master/program",
    source_release: "token-2022-v7.0.0",
    auditors: "https://github.com/anza-xyz/security-audits#token-2022"
}
