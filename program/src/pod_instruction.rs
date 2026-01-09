//! Rewrites of the instruction data types represented as Pods

use {
    bytemuck::{Pod, Zeroable},
    num_enum::{IntoPrimitive, TryFromPrimitive},
    solana_program_error::ProgramError,
    solana_pubkey::{Pubkey, PUBKEY_BYTES},
    spl_pod::{
        bytemuck::{pod_from_bytes, pod_get_packed_len},
        primitives::PodU64,
    },
    spl_token_2022_interface::pod::PodCOption,
};

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub(crate) struct InitializeMintData {
    /// Number of base 10 digits to the right of the decimal place.
    pub(crate) decimals: u8,
    /// The authority/multisignature to mint tokens.
    pub(crate) mint_authority: Pubkey,
    // The freeze authority option comes later, but cannot be included as
    // plain old data in this struct
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub(crate) struct InitializeMultisigData {
    /// The number of signers (M) required to validate this multisignature
    /// account.
    pub(crate) m: u8,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub(crate) struct AmountData {
    /// The amount of tokens to transfer.
    pub(crate) amount: PodU64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub(crate) struct AmountCheckedData {
    /// The amount of tokens to transfer.
    pub(crate) amount: PodU64,
    /// Decimals of the mint
    pub(crate) decimals: u8,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub(crate) struct SetAuthorityData {
    /// The type of authority to update.
    pub(crate) authority_type: u8,
    // The new authority option comes later, but cannot be included as
    // plain old data in this struct
}

/// All of the base instructions in Token-2022, reduced down to their one-byte
/// discriminant.
///
/// All instructions that expect data afterwards include a comment with the data
/// type expected. For example, `PodTokenInstruction::InitializeMint` expects
/// `InitializeMintData`.
#[derive(Clone, Copy, Debug, PartialEq, TryFromPrimitive, IntoPrimitive)]
#[repr(u8)]
pub(crate) enum PodTokenInstruction {
    // 0
    InitializeMint, // InitializeMintData
    InitializeAccount,
    InitializeMultisig, // InitializeMultisigData
    Transfer,           // AmountData
    Approve,            // AmountData
    // 5
    Revoke,
    SetAuthority, // SetAuthorityData
    MintTo,       // AmountData
    Burn,         // AmountData
    CloseAccount,
    // 10
    FreezeAccount,
    ThawAccount,
    TransferChecked, // AmountCheckedData
    ApproveChecked,  // AmountCheckedData
    MintToChecked,   // AmountCheckedData
    // 15
    BurnChecked,        // AmountCheckedData
    InitializeAccount2, // Pubkey
    SyncNative,
    InitializeAccount3,  // Pubkey
    InitializeMultisig2, // InitializeMultisigData
    // 20
    InitializeMint2,    // InitializeMintData
    GetAccountDataSize, // &[ExtensionType]
    InitializeImmutableOwner,
    AmountToUiAmount, // AmountData
    UiAmountToAmount, // &str
    // 25
    InitializeMintCloseAuthority, // COption<Pubkey>
    TransferFeeExtension,
    ConfidentialTransferExtension,
    DefaultAccountStateExtension,
    Reallocate, // &[ExtensionType]
    // 30
    MemoTransferExtension,
    CreateNativeMint,
    InitializeNonTransferableMint,
    InterestBearingMintExtension,
    CpiGuardExtension,
    // 35
    InitializePermanentDelegate, // Pubkey
    TransferHookExtension,
    ConfidentialTransferFeeExtension,
    WithdrawExcessLamports,
    MetadataPointerExtension,
    // 40
    GroupPointerExtension,
    GroupMemberPointerExtension,
    ConfidentialMintBurnExtension,
    ScaledUiAmountExtension,
    PausableExtension,
    // 45
    UnwrapLamports,
    // 255
    Batch = 255,
}

fn unpack_pubkey_option(input: &[u8]) -> Result<PodCOption<Pubkey>, ProgramError> {
    match input.split_first() {
        Option::Some((&0, _)) => Ok(PodCOption::none()),
        Option::Some((&1, rest)) => {
            let pk = rest
                .get(..PUBKEY_BYTES)
                .and_then(|x| Pubkey::try_from(x).ok())
                .ok_or(ProgramError::InvalidInstructionData)?;
            Ok(PodCOption::some(pk))
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

const U64_BYTES: usize = 8;
fn unpack_u64_option(input: &[u8]) -> Result<PodCOption<u64>, ProgramError> {
    match input.split_first() {
        Option::Some((&0, _)) => Ok(PodCOption::none()),
        Option::Some((&1, rest)) => {
            let amount = rest
                .get(..U64_BYTES)
                .and_then(|x| x.try_into().map(u64::from_le_bytes).ok())
                .ok_or(ProgramError::InvalidInstructionData)?;
            Ok(PodCOption::some(amount))
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

/// Specialty function for deserializing `Pod` data and a `COption<Pubkey>`
///
/// `COption<T>` is not `Pod` compatible when serialized in an instruction, but
/// since it is always at the end of an instruction, so we can do this safely
pub(crate) fn decode_instruction_data_with_coption_pubkey<T: Pod>(
    input_with_type: &[u8],
) -> Result<(&T, PodCOption<Pubkey>), ProgramError> {
    let end_of_t = pod_get_packed_len::<T>().saturating_add(1);
    let value = input_with_type
        .get(1..end_of_t)
        .ok_or(ProgramError::InvalidInstructionData)
        .and_then(pod_from_bytes)?;
    let pubkey = unpack_pubkey_option(&input_with_type[end_of_t..])?;
    Ok((value, pubkey))
}

/// Specialty function for deserializing `Pod` data and a `COption<u64>`
///
/// `COption<T>` is not `Pod` compatible when serialized in an instruction, but
/// since it is always at the end of an instruction, so we can do this safely
pub(crate) fn decode_instruction_data_with_coption_u64<T: Pod>(
    input_with_type: &[u8],
) -> Result<(&T, PodCOption<u64>), ProgramError> {
    let end_of_t = pod_get_packed_len::<T>().saturating_add(1);
    let value = input_with_type
        .get(1..end_of_t)
        .ok_or(ProgramError::InvalidInstructionData)
        .and_then(pod_from_bytes)?;
    let amount = unpack_u64_option(&input_with_type[end_of_t..])?;
    Ok((value, amount))
}

#[cfg(test)]
mod tests {
    use {
        super::*,
        crate::{
            extension::ExtensionType,
            instruction::{
                decode_instruction_data, decode_instruction_type, AuthorityType, TokenInstruction,
            },
        },
        proptest::prelude::*,
        solana_program_option::COption,
    };

    // Test function that mimics the "unpacking" in `Processor::process` by
    // trying to deserialize the relevant type data after the instruction type
    fn check_pod_instruction(input: &[u8]) -> Result<(), ProgramError> {
        if let Ok(instruction_type) = decode_instruction_type(input) {
            match instruction_type {
                PodTokenInstruction::InitializeMint | PodTokenInstruction::InitializeMint2 => {
                    let _ =
                        decode_instruction_data_with_coption_pubkey::<InitializeMintData>(input)?;
                }
                PodTokenInstruction::InitializeAccount2
                | PodTokenInstruction::InitializeAccount3
                | PodTokenInstruction::InitializePermanentDelegate => {
                    let _ = decode_instruction_data::<Pubkey>(input)?;
                }
                PodTokenInstruction::InitializeMultisig
                | PodTokenInstruction::InitializeMultisig2 => {
                    let _ = decode_instruction_data::<InitializeMultisigData>(input)?;
                }
                PodTokenInstruction::SetAuthority => {
                    let _ = decode_instruction_data_with_coption_pubkey::<SetAuthorityData>(input)?;
                }
                PodTokenInstruction::Transfer
                | PodTokenInstruction::Approve
                | PodTokenInstruction::MintTo
                | PodTokenInstruction::Burn
                | PodTokenInstruction::AmountToUiAmount => {
                    let _ = decode_instruction_data::<AmountData>(input)?;
                }
                PodTokenInstruction::TransferChecked
                | PodTokenInstruction::ApproveChecked
                | PodTokenInstruction::MintToChecked
                | PodTokenInstruction::BurnChecked => {
                    let _ = decode_instruction_data::<AmountCheckedData>(input)?;
                }
                PodTokenInstruction::UnwrapLamports => {
                    let _ = decode_instruction_data_with_coption_u64::<()>(input)?;
                }
                PodTokenInstruction::InitializeMintCloseAuthority => {
                    let _ = decode_instruction_data_with_coption_pubkey::<()>(input)?;
                }
                PodTokenInstruction::UiAmountToAmount => {
                    let _ = std::str::from_utf8(&input[1..])
                        .map_err(|_| ProgramError::InvalidInstructionData)?;
                }
                PodTokenInstruction::GetAccountDataSize | PodTokenInstruction::Reallocate => {
                    let _ = input[1..]
                        .chunks(std::mem::size_of::<ExtensionType>())
                        .map(ExtensionType::try_from)
                        .collect::<Result<Vec<_>, _>>()?;
                }
                _ => {
                    // no extra data to deserialize
                }
            }
        }
        Ok(())
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(1024))]
        #[test]
        fn test_instruction_unpack_proptest(
            data in prop::collection::vec(any::<u8>(), 0..255)
        ) {
            let _no_panic = check_pod_instruction(&data);
        }
    }

    #[test]
    fn test_initialize_mint_packing() {
        let decimals = 2;
        let mint_authority = Pubkey::new_from_array([1u8; 32]);
        let freeze_authority = COption::None;
        let check = TokenInstruction::InitializeMint {
            decimals,
            mint_authority,
            freeze_authority,
        };
        let packed = check.pack();
        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::InitializeMint);
        let (pod, pod_freeze_authority) =
            decode_instruction_data_with_coption_pubkey::<InitializeMintData>(&packed).unwrap();
        assert_eq!(pod.decimals, decimals);
        assert_eq!(pod.mint_authority, mint_authority);
        assert_eq!(pod_freeze_authority, freeze_authority.into());

        let mint_authority = Pubkey::new_from_array([2u8; 32]);
        let freeze_authority = COption::Some(Pubkey::new_from_array([3u8; 32]));
        let check = TokenInstruction::InitializeMint {
            decimals,
            mint_authority,
            freeze_authority,
        };
        let packed = check.pack();

        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::InitializeMint);
        let (pod, pod_freeze_authority) =
            decode_instruction_data_with_coption_pubkey::<InitializeMintData>(&packed).unwrap();
        assert_eq!(pod.decimals, decimals);
        assert_eq!(pod.mint_authority, mint_authority);
        assert_eq!(pod_freeze_authority, freeze_authority.into());
    }

    #[test]
    fn test_initialize_account_packing() {
        let check = TokenInstruction::InitializeAccount;
        let packed = check.pack();
        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::InitializeAccount);
    }

    #[test]
    fn test_initialize_multisig_packing() {
        let m = 1;
        let check = TokenInstruction::InitializeMultisig { m };
        let packed = check.pack();
        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::InitializeMultisig);
        let pod = decode_instruction_data::<InitializeMultisigData>(&packed).unwrap();
        assert_eq!(pod.m, m);
    }

    #[test]
    fn test_transfer_packing() {
        let amount = 1;
        #[allow(deprecated)]
        let check = TokenInstruction::Transfer { amount };
        let packed = check.pack();

        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::Transfer);
        let pod = decode_instruction_data::<AmountData>(&packed).unwrap();
        assert_eq!(pod.amount, amount.into());
    }

    #[test]
    fn test_approve_packing() {
        let amount = 1;
        let check = TokenInstruction::Approve { amount };
        let packed = check.pack();

        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::Approve);
        let pod = decode_instruction_data::<AmountData>(&packed).unwrap();
        assert_eq!(pod.amount, amount.into());
    }

    #[test]
    fn test_revoke_packing() {
        let check = TokenInstruction::Revoke;
        let packed = check.pack();
        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::Revoke);
    }

    #[test]
    fn test_set_authority_packing() {
        let authority_type = AuthorityType::FreezeAccount;
        let new_authority = COption::Some(Pubkey::new_from_array([4u8; 32]));
        let check = TokenInstruction::SetAuthority {
            authority_type: authority_type.clone(),
            new_authority,
        };
        let packed = check.pack();

        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::SetAuthority);
        let (pod, pod_new_authority) =
            decode_instruction_data_with_coption_pubkey::<SetAuthorityData>(&packed).unwrap();
        assert_eq!(
            AuthorityType::from(pod.authority_type).unwrap(),
            authority_type
        );
        assert_eq!(pod_new_authority, new_authority.into());
    }

    #[test]
    fn test_mint_to_packing() {
        let amount = 1;
        let check = TokenInstruction::MintTo { amount };
        let packed = check.pack();

        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::MintTo);
        let pod = decode_instruction_data::<AmountData>(&packed).unwrap();
        assert_eq!(pod.amount, amount.into());
    }

    #[test]
    fn test_burn_packing() {
        let amount = 1;
        let check = TokenInstruction::Burn { amount };
        let packed = check.pack();

        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::Burn);
        let pod = decode_instruction_data::<AmountData>(&packed).unwrap();
        assert_eq!(pod.amount, amount.into());
    }

    #[test]
    fn test_close_account_packing() {
        let check = TokenInstruction::CloseAccount;
        let packed = check.pack();
        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::CloseAccount);
    }

    #[test]
    fn test_freeze_account_packing() {
        let check = TokenInstruction::FreezeAccount;
        let packed = check.pack();
        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::FreezeAccount);
    }

    #[test]
    fn test_thaw_account_packing() {
        let check = TokenInstruction::ThawAccount;
        let packed = check.pack();
        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::ThawAccount);
    }

    #[test]
    fn test_transfer_checked_packing() {
        let amount = 1;
        let decimals = 2;
        let check = TokenInstruction::TransferChecked { amount, decimals };
        let packed = check.pack();

        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::TransferChecked);
        let pod = decode_instruction_data::<AmountCheckedData>(&packed).unwrap();
        assert_eq!(pod.amount, amount.into());
        assert_eq!(pod.decimals, decimals);
    }

    #[test]
    fn test_approve_checked_packing() {
        let amount = 1;
        let decimals = 2;

        let check = TokenInstruction::ApproveChecked { amount, decimals };
        let packed = check.pack();

        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::ApproveChecked);
        let pod = decode_instruction_data::<AmountCheckedData>(&packed).unwrap();
        assert_eq!(pod.amount, amount.into());
        assert_eq!(pod.decimals, decimals);
    }

    #[test]
    fn test_mint_to_checked_packing() {
        let amount = 1;
        let decimals = 2;
        let check = TokenInstruction::MintToChecked { amount, decimals };
        let packed = check.pack();
        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::MintToChecked);
        let pod = decode_instruction_data::<AmountCheckedData>(&packed).unwrap();
        assert_eq!(pod.amount, amount.into());
        assert_eq!(pod.decimals, decimals);
    }

    #[test]
    fn test_burn_checked_packing() {
        let amount = 1;
        let decimals = 2;
        let check = TokenInstruction::BurnChecked { amount, decimals };
        let packed = check.pack();

        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::BurnChecked);
        let pod = decode_instruction_data::<AmountCheckedData>(&packed).unwrap();
        assert_eq!(pod.amount, amount.into());
        assert_eq!(pod.decimals, decimals);
    }

    #[test]
    fn test_initialize_account2_packing() {
        let owner = Pubkey::new_from_array([2u8; 32]);
        let check = TokenInstruction::InitializeAccount2 { owner };
        let packed = check.pack();

        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::InitializeAccount2);
        let pod_owner = decode_instruction_data::<Pubkey>(&packed).unwrap();
        assert_eq!(*pod_owner, owner);
    }

    #[test]
    fn test_sync_native_packing() {
        let check = TokenInstruction::SyncNative;
        let packed = check.pack();

        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::SyncNative);
    }

    #[test]
    fn test_initialize_account3_packing() {
        let owner = Pubkey::new_from_array([2u8; 32]);
        let check = TokenInstruction::InitializeAccount3 { owner };
        let packed = check.pack();

        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::InitializeAccount3);
        let pod_owner = decode_instruction_data::<Pubkey>(&packed).unwrap();
        assert_eq!(*pod_owner, owner);
    }

    #[test]
    fn test_initialize_multisig2_packing() {
        let m = 1;
        let check = TokenInstruction::InitializeMultisig2 { m };
        let packed = check.pack();

        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::InitializeMultisig2);
        let pod = decode_instruction_data::<InitializeMultisigData>(&packed).unwrap();
        assert_eq!(pod.m, m);
    }

    #[test]
    fn test_initialize_mint2_packing() {
        let decimals = 2;
        let mint_authority = Pubkey::new_from_array([1u8; 32]);
        let freeze_authority = COption::None;
        let check = TokenInstruction::InitializeMint2 {
            decimals,
            mint_authority,
            freeze_authority,
        };
        let packed = check.pack();

        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::InitializeMint2);
        let (pod, pod_freeze_authority) =
            decode_instruction_data_with_coption_pubkey::<InitializeMintData>(&packed).unwrap();
        assert_eq!(pod.decimals, decimals);
        assert_eq!(pod.mint_authority, mint_authority);
        assert_eq!(pod_freeze_authority, freeze_authority.into());

        let decimals = 2;
        let mint_authority = Pubkey::new_from_array([2u8; 32]);
        let freeze_authority = COption::Some(Pubkey::new_from_array([3u8; 32]));
        let check = TokenInstruction::InitializeMint2 {
            decimals,
            mint_authority,
            freeze_authority,
        };
        let packed = check.pack();

        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::InitializeMint2);
        let (pod, pod_freeze_authority) =
            decode_instruction_data_with_coption_pubkey::<InitializeMintData>(&packed).unwrap();
        assert_eq!(pod.decimals, decimals);
        assert_eq!(pod.mint_authority, mint_authority);
        assert_eq!(pod_freeze_authority, freeze_authority.into());
    }

    #[test]
    fn test_batch_packing() {
        let create_account_instr_data = TokenInstruction::InitializeAccount {}.pack();
        let close_account_instr_data = TokenInstruction::CloseAccount {}.pack();
        let approve_instr_data = TokenInstruction::Approve { amount: 500 }.pack();

        let mut batch_data = Vec::new();
        batch_data.push(4);
        batch_data.push(create_account_instr_data.len() as u8);
        batch_data.extend_from_slice(&create_account_instr_data);
        batch_data.push(3);
        batch_data.push(close_account_instr_data.len() as u8);
        batch_data.extend_from_slice(&close_account_instr_data);
        batch_data.push(3);
        batch_data.push(approve_instr_data.len() as u8);
        batch_data.extend_from_slice(&approve_instr_data);

        let check = TokenInstruction::Batch {
            data: batch_data.clone(),
        };
        let packed = check.pack();

        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();

        assert_eq!(instruction_type, PodTokenInstruction::Batch);
        assert_eq!(batch_data, packed[1..]);
    }
    #[test]
    fn test_get_account_data_size_packing() {
        let extension_types = vec![];
        let check = TokenInstruction::GetAccountDataSize {
            extension_types: extension_types.clone(),
        };
        let packed = check.pack();

        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::GetAccountDataSize);
        let pod_extension_types = packed[1..]
            .chunks(std::mem::size_of::<ExtensionType>())
            .map(ExtensionType::try_from)
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(pod_extension_types, extension_types);

        let extension_types = vec![
            ExtensionType::TransferFeeConfig,
            ExtensionType::TransferFeeAmount,
        ];
        let check = TokenInstruction::GetAccountDataSize {
            extension_types: extension_types.clone(),
        };
        let packed = check.pack();

        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::GetAccountDataSize);
        let pod_extension_types = packed[1..]
            .chunks(std::mem::size_of::<ExtensionType>())
            .map(ExtensionType::try_from)
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(pod_extension_types, extension_types);
    }

    #[test]
    fn test_amount_to_ui_amount_packing() {
        let amount = 42;
        let check = TokenInstruction::AmountToUiAmount { amount };
        let packed = check.pack();

        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::AmountToUiAmount);
        let data = decode_instruction_data::<AmountData>(&packed).unwrap();
        assert_eq!(data.amount, amount.into());
    }

    #[test]
    fn test_ui_amount_to_amount_packing() {
        let ui_amount = "0.42";
        let check = TokenInstruction::UiAmountToAmount { ui_amount };
        let packed = check.pack();

        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::UiAmountToAmount);
        let pod_ui_amount = std::str::from_utf8(&packed[1..]).unwrap();
        assert_eq!(pod_ui_amount, ui_amount);
    }

    #[test]
    fn test_initialize_mint_close_authority_packing() {
        let close_authority = COption::Some(Pubkey::new_from_array([10u8; 32]));
        let check = TokenInstruction::InitializeMintCloseAuthority { close_authority };
        let packed = check.pack();

        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(
            instruction_type,
            PodTokenInstruction::InitializeMintCloseAuthority
        );
        let (_, pod_close_authority) =
            decode_instruction_data_with_coption_pubkey::<()>(&packed).unwrap();
        assert_eq!(pod_close_authority, close_authority.into());
    }

    #[test]
    fn test_unwrap_lamports_packing() {
        let amount = COption::Some(1);
        let check = TokenInstruction::UnwrapLamports { amount };
        let packed = check.pack();

        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::UnwrapLamports);
        let (_, pod_amount) = decode_instruction_data_with_coption_u64::<()>(&packed).unwrap();
        assert_eq!(pod_amount, amount.into());
    }

    #[test]
    fn test_create_native_mint_packing() {
        let check = TokenInstruction::CreateNativeMint;
        let packed = check.pack();

        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(instruction_type, PodTokenInstruction::CreateNativeMint);
    }

    #[test]
    fn test_initialize_permanent_delegate_packing() {
        let delegate = Pubkey::new_from_array([11u8; 32]);
        let check = TokenInstruction::InitializePermanentDelegate { delegate };
        let packed = check.pack();

        let instruction_type = decode_instruction_type::<PodTokenInstruction>(&packed).unwrap();
        assert_eq!(
            instruction_type,
            PodTokenInstruction::InitializePermanentDelegate
        );
        let pod_delegate = decode_instruction_data::<Pubkey>(&packed).unwrap();
        assert_eq!(*pod_delegate, delegate);
    }
}
