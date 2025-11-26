use {
    crate::{
        pod_instruction::{AmountCheckedData, AmountData},
        processor::{BurnInstructionVariant, InstructionVariant, Processor},
    },
    solana_account_info::{next_account_info, AccountInfo},
    solana_msg::msg,
    solana_program_error::ProgramResult,
    solana_pubkey::Pubkey,
    spl_token_2022_interface::{
        check_program_account,
        extension::{
            permissioned_burn::{
                instruction::{InitializeInstructionData, PermissionedBurnInstruction},
                PermissionedBurnConfig,
            },
            BaseStateWithExtensionsMut, PodStateWithExtensionsMut,
        },
        instruction::{decode_instruction_data, decode_instruction_type},
        pod::PodMint,
    },
};

fn process_initialize(
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

pub(crate) fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    input: &[u8],
) -> ProgramResult {
    check_program_account(program_id)?;

    match decode_instruction_type(input)? {
        PermissionedBurnInstruction::Initialize => {
            msg!("PermissionedBurnInstruction::Initialize");
            let InitializeInstructionData { authority } = decode_instruction_data(input)?;
            process_initialize(program_id, accounts, authority)
        }
        PermissionedBurnInstruction::Burn => {
            msg!("PermissionedBurnInstruction::Burn");
            let data = decode_instruction_data::<AmountData>(input)?;
            Processor::process_burn(
                program_id,
                accounts,
                data.amount.into(),
                BurnInstructionVariant::Permissioned(InstructionVariant::Unchecked),
            )
        }
        PermissionedBurnInstruction::BurnChecked => {
            msg!("PermissionedBurnInstruction::BurnChecked");
            let data = decode_instruction_data::<AmountCheckedData>(input)?;
            Processor::process_burn(
                program_id,
                accounts,
                data.amount.into(),
                BurnInstructionVariant::Permissioned(InstructionVariant::Checked {
                    decimals: data.decimals,
                }),
            )
        }
    }
}
