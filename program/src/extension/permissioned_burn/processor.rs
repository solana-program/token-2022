use {
    crate::processor::Processor,
    solana_account_info::{next_account_info, AccountInfo},
    solana_msg::msg,
    solana_program_error::ProgramResult,
    solana_pubkey::Pubkey,
    spl_token_2022_interface::{
        check_program_account,
        error::TokenError,
        extension::{
            permissioned_burn::{
                instruction::{EnableInstructionData, PermissionedBurnInstruction},
                PermissionedBurnConfig,
            },
            BaseStateWithExtensionsMut, PodStateWithExtensionsMut,
        },
        instruction::{decode_instruction_data, decode_instruction_type},
        pod::PodMint,
    },
};

fn process_enable(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    authority: &Pubkey,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let mint_account_info = next_account_info(account_info_iter)?;
    let mut mint_data = mint_account_info.data.borrow_mut();
    let mut mint = PodStateWithExtensionsMut::<PodMint>::unpack_uninitialized(&mut mint_data)?;

    let extension = mint.init_extension::<PermissionedBurnConfig>(true)?;
    extension.authority = Some(*authority).try_into()?;

    Ok(())
}

// /// Enable or disable permissioned burn.
// fn process_toggle_permissioned_burn(
//     program_id: &Pubkey,
//     accounts: &[AccountInfo],
//     enable: bool,
// ) -> ProgramResult {
//     let account_info_iter = &mut accounts.iter();
//     let mint_account_info = next_account_info(account_info_iter)?;
//     let authority_info = next_account_info(account_info_iter)?;
//     let authority_info_data_len = authority_info.data_len();

//     let mut mint_data = mint_account_info.data.borrow_mut();
//     let mut mint = PodStateWithExtensionsMut::<PodMint>::unpack(&mut mint_data)?;
//     let extension = mint.get_extension_mut::<PermissionedBurnConfig>()?;
//     let maybe_authority: Option<Pubkey> = extension.authority.into();
//     let authority = maybe_authority.ok_or(TokenError::AuthorityTypeNotSupported)?;

//     Processor::validate_owner(
//         program_id,
//         &authority,
//         authority_info,
//         authority_info_data_len,
//         account_info_iter.as_slice(),
//     )?;

//     extension.enabled = enable.into();
//     Ok(())
// }

pub(crate) fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    input: &[u8],
) -> ProgramResult {
    check_program_account(program_id)?;

    match decode_instruction_type(input)? {
        PermissionedBurnInstruction::Enable => {
            msg!("PermissionedBurnInstruction::Enable");
            let EnableInstructionData { authority } = decode_instruction_data(input)?;
            process_enable(program_id, accounts, authority)
        }
        PermissionedBurnInstruction::Disable => {
            msg!("PermissionedBurnInstruction::Disable");
            Ok(())
            // process_toggle_permissioned_burn(program_id, accounts, false)
        }
    }
}
