use {
    crate::{next_account_view, processor::Processor},
    pinocchio::AccountView,
    solana_address::Address,
    solana_msg::msg,
    solana_program_error::ProgramResult,
    spl_token_2022_interface::{
        check_program_account,
        extension::{
            memo_transfer::{instruction::RequiredMemoTransfersInstruction, MemoTransfer},
            BaseStateWithExtensionsMut, PodStateWithExtensionsMut,
        },
        instruction::decode_instruction_type,
        pod::PodAccount,
    },
};

/// Toggle the `RequiredMemoTransfers` extension, initializing the extension if
/// not already present.
fn process_toggle_required_memo_transfers(
    program_id: &Address,
    accounts: &mut [AccountView],
    enable: bool,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter_mut();
    let token_account_info = next_account_view(account_info_iter)?;
    let owner_info = next_account_view(account_info_iter)?;
    let owner_info_data_len = owner_info.data_len();
    check_program_account(token_account_info.owner())?;

    let mut account_data = token_account_info.try_borrow_mut()?;
    let mut account = PodStateWithExtensionsMut::<PodAccount>::unpack(&mut account_data)?;

    Processor::validate_owner(
        program_id,
        &account.base.owner,
        owner_info,
        owner_info_data_len,
        account_info_iter.as_slice(),
    )?;

    let extension = if let Ok(extension) = account.get_extension_mut::<MemoTransfer>() {
        extension
    } else {
        account.init_extension::<MemoTransfer>(true)?
    };
    extension.require_incoming_transfer_memos = enable.into();
    Ok(())
}

pub(crate) fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    input: &[u8],
) -> ProgramResult {
    check_program_account(program_id)?;

    match decode_instruction_type(input)? {
        RequiredMemoTransfersInstruction::Enable => {
            msg!("RequiredMemoTransfersInstruction::Enable");
            process_toggle_required_memo_transfers(program_id, accounts, true /* enable */)
        }
        RequiredMemoTransfersInstruction::Disable => {
            msg!("RequiredMemoTransfersInstruction::Disable");
            process_toggle_required_memo_transfers(program_id, accounts, false /* disable */)
        }
    }
}
