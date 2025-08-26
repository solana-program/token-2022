//! Utility functions to simplify the handling of ZK ElGamal proof program
//! instruction data in SPL crates

use {
    bytemuck::Pod,
    solana_account_info::{next_account_info, AccountInfo},
    solana_instruction::{AccountMeta, Instruction},
    solana_instructions_sysvar::get_instruction_relative,
    solana_msg::msg,
    solana_program_error::{ProgramError, ProgramResult},
    solana_pubkey::Pubkey,
    solana_zk_sdk::zk_elgamal_proof_program::{
        self,
        instruction::ProofInstruction,
        proof_data::{ProofType, ZkProofData},
        state::ProofContextState,
    },
    spl_pod::bytemuck::pod_from_bytes,
    std::{num::NonZeroI8, slice::Iter},
};

/// Checks that the supplied program ID is correct for the ZK ElGamal proof
/// program
pub fn check_zk_elgamal_proof_program_account(
    zk_elgamal_proof_program_id: &Pubkey,
) -> ProgramResult {
    if zk_elgamal_proof_program_id != &solana_zk_sdk::zk_elgamal_proof_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }
    Ok(())
}

/// Decodes the proof context data associated with a zero-knowledge proof
/// instruction.
pub fn decode_proof_instruction_context<T: Pod + ZkProofData<U>, U: Pod>(
    expected: ProofInstruction,
    instruction: &Instruction,
) -> Result<U, ProgramError> {
    if instruction.program_id != zk_elgamal_proof_program::id()
        || ProofInstruction::instruction_type(&instruction.data) != Some(expected)
    {
        msg!("Unexpected proof instruction");
        return Err(ProgramError::InvalidInstructionData);
    }
    ProofInstruction::proof_data::<T, U>(&instruction.data)
        .map(|proof_data| *ZkProofData::context_data(proof_data))
        .ok_or(ProgramError::InvalidInstructionData)
}

/// A proof location type meant to be used for arguments to instruction
/// constructors.
#[derive(Clone, Copy)]
pub enum ProofLocation<'a, T> {
    /// The proof is included in the same transaction of a corresponding
    /// token-2022 instruction.
    InstructionOffset(NonZeroI8, &'a T),
    /// The proof is pre-verified into a context state account.
    ContextStateAccount(&'a Pubkey),
}

impl<T> ProofLocation<'_, T> {
    /// Returns true if the proof location is an instruction offset
    pub fn is_instruction_offset(&self) -> bool {
        match self {
            Self::InstructionOffset(_, _) => true,
            Self::ContextStateAccount(_) => false,
        }
    }
}

/// Verify zero-knowledge proof and return the corresponding proof context.
pub fn verify_and_extract_context<'a, T: Pod + ZkProofData<U>, U: Pod>(
    account_info_iter: &mut Iter<'_, AccountInfo<'a>>,
    proof_instruction_offset: i64,
    sysvar_account_info: Option<&'_ AccountInfo<'a>>,
) -> Result<U, ProgramError> {
    if proof_instruction_offset == 0 {
        // interpret `account_info` as a context state account
        let context_state_account_info = next_account_info(account_info_iter)?;
        check_zk_elgamal_proof_program_account(context_state_account_info.owner)?;
        let context_state_account_data = context_state_account_info.data.borrow();
        let context_state = pod_from_bytes::<ProofContextState<U>>(&context_state_account_data)?;

        if context_state.proof_type != T::PROOF_TYPE.into() {
            return Err(ProgramError::InvalidInstructionData);
        }

        Ok(context_state.proof_context)
    } else {
        // if sysvar account is not provided, then get the sysvar account
        let sysvar_account_info = if let Some(sysvar_account_info) = sysvar_account_info {
            sysvar_account_info
        } else {
            next_account_info(account_info_iter)?
        };
        let zkp_instruction =
            get_instruction_relative(proof_instruction_offset, sysvar_account_info)?;
        let expected_proof_type = zk_proof_type_to_instruction(T::PROOF_TYPE)?;
        Ok(decode_proof_instruction_context::<T, U>(
            expected_proof_type,
            &zkp_instruction,
        )?)
    }
}

/// Processes a proof location for instruction creation. Adds relevant accounts
/// to supplied account vector
///
/// If the proof location is an instruction offset the corresponding proof
/// instruction is created and added to the `proof_instructions` vector.
pub fn process_proof_location<T, U>(
    accounts: &mut Vec<AccountMeta>,
    expected_instruction_offset: &mut i8,
    proof_instructions: &mut Vec<Instruction>,
    proof_location: ProofLocation<T>,
    push_sysvar_to_accounts: bool,
    proof_instruction_type: ProofInstruction,
) -> Result<i8, ProgramError>
where
    T: Pod + ZkProofData<U>,
    U: Pod,
{
    match proof_location {
        ProofLocation::InstructionOffset(proof_instruction_offset, proof_data) => {
            let proof_instruction_offset: i8 = proof_instruction_offset.into();
            if &proof_instruction_offset != expected_instruction_offset {
                return Err(ProgramError::InvalidInstructionData);
            }

            if push_sysvar_to_accounts {
                accounts.push(AccountMeta::new_readonly(
                    solana_sdk_ids::sysvar::instructions::id(),
                    false,
                ));
            }
            proof_instructions
                .push(proof_instruction_type.encode_verify_proof::<T, U>(None, proof_data));
            *expected_instruction_offset = expected_instruction_offset
                .checked_add(1)
                .ok_or(ProgramError::InvalidInstructionData)?;
            Ok(proof_instruction_offset)
        }
        ProofLocation::ContextStateAccount(context_state_account) => {
            accounts.push(AccountMeta::new_readonly(*context_state_account, false));
            Ok(0)
        }
    }
}

/// Converts a zk proof type to a corresponding ZK ElGamal proof program
/// instruction that verifies the proof.
pub fn zk_proof_type_to_instruction(
    proof_type: ProofType,
) -> Result<ProofInstruction, ProgramError> {
    match proof_type {
        ProofType::ZeroCiphertext => Ok(ProofInstruction::VerifyZeroCiphertext),
        ProofType::CiphertextCiphertextEquality => {
            Ok(ProofInstruction::VerifyCiphertextCiphertextEquality)
        }
        ProofType::PubkeyValidity => Ok(ProofInstruction::VerifyPubkeyValidity),
        ProofType::BatchedRangeProofU64 => Ok(ProofInstruction::VerifyBatchedRangeProofU64),
        ProofType::BatchedRangeProofU128 => Ok(ProofInstruction::VerifyBatchedRangeProofU128),
        ProofType::BatchedRangeProofU256 => Ok(ProofInstruction::VerifyBatchedRangeProofU256),
        ProofType::CiphertextCommitmentEquality => {
            Ok(ProofInstruction::VerifyCiphertextCommitmentEquality)
        }
        ProofType::GroupedCiphertext2HandlesValidity => {
            Ok(ProofInstruction::VerifyGroupedCiphertext2HandlesValidity)
        }
        ProofType::BatchedGroupedCiphertext2HandlesValidity => {
            Ok(ProofInstruction::VerifyBatchedGroupedCiphertext2HandlesValidity)
        }
        ProofType::PercentageWithCap => Ok(ProofInstruction::VerifyPercentageWithCap),
        ProofType::GroupedCiphertext3HandlesValidity => {
            Ok(ProofInstruction::VerifyGroupedCiphertext3HandlesValidity)
        }
        ProofType::BatchedGroupedCiphertext3HandlesValidity => {
            Ok(ProofInstruction::VerifyBatchedGroupedCiphertext3HandlesValidity)
        }
        ProofType::Uninitialized => Err(ProgramError::InvalidInstructionData),
    }
}
