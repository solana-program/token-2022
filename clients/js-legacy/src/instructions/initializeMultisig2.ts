import { struct, u8 } from '@solana/buffer-layout';
import type { AccountMeta, Signer } from '@solana/web3.js';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '../constants.js';
import {
    TokenInvalidInstructionDataError,
    TokenInvalidInstructionKeysError,
    TokenInvalidInstructionProgramError,
    TokenInvalidInstructionTypeError,
} from '../errors.js';
import { TokenInstruction } from './types.js';

/** InitializeMultisig2 instruction data */
export interface InitializeMultisig2InstructionData {
    instruction: TokenInstruction.InitializeMultisig2;
    m: number;
}

/** InitializeMultisig2 instruction layout */
export const initializeMultisig2InstructionData = struct<InitializeMultisig2InstructionData>([
    u8('instruction'),
    u8('m'),
]);

/**
 * Construct an InitializeMultisig2 instruction
 *
 * @param account   Multisig account
 * @param signers   Full set of signers
 * @param m         Number of required signatures
 * @param programId SPL Token program account
 *
 * @return Instruction to add to a transaction
 */
export function createInitializeMultisig2Instruction(
    account: PublicKey,
    signers: (Signer | PublicKey)[],
    m: number,
    programId = TOKEN_PROGRAM_ID,
): TransactionInstruction {
    const keys = [{ pubkey: account, isSigner: false, isWritable: true }];
    for (const signer of signers) {
        keys.push({
            pubkey: signer instanceof PublicKey ? signer : signer.publicKey,
            isSigner: false,
            isWritable: false,
        });
    }

    const data = Buffer.alloc(initializeMultisig2InstructionData.span);
    initializeMultisig2InstructionData.encode(
        {
            instruction: TokenInstruction.InitializeMultisig2,
            m,
        },
        data,
    );

    return new TransactionInstruction({ keys, programId, data });
}

/** A decoded, valid InitializeMultisig2 instruction */
export interface DecodedInitializeMultisig2Instruction {
    programId: PublicKey;
    keys: {
        account: AccountMeta;
        signers: AccountMeta[];
    };
    data: {
        instruction: TokenInstruction.InitializeMultisig2;
        m: number;
    };
}

/**
 * Decode an InitializeMultisig2 instruction and validate it
 *
 * @param instruction Transaction instruction to decode
 * @param programId   SPL Token program account
 *
 * @return Decoded, valid instruction
 */
export function decodeInitializeMultisig2Instruction(
    instruction: TransactionInstruction,
    programId = TOKEN_PROGRAM_ID,
): DecodedInitializeMultisig2Instruction {
    if (!instruction.programId.equals(programId)) throw new TokenInvalidInstructionProgramError();
    if (instruction.data.length !== initializeMultisig2InstructionData.span)
        throw new TokenInvalidInstructionDataError();

    const {
        keys: { account, signers },
        data,
    } = decodeInitializeMultisig2InstructionUnchecked(instruction);
    if (data.instruction !== TokenInstruction.InitializeMultisig2) throw new TokenInvalidInstructionTypeError();
    if (!account || !signers.length) throw new TokenInvalidInstructionKeysError();

    return {
        programId,
        keys: {
            account,
            signers,
        },
        data,
    };
}

/** A decoded, non-validated InitializeMultisig2 instruction */
export interface DecodedInitializeMultisig2InstructionUnchecked {
    programId: PublicKey;
    keys: {
        account: AccountMeta | undefined;
        signers: AccountMeta[];
    };
    data: {
        instruction: number;
        m: number;
    };
}

/**
 * Decode an InitializeMultisig2 instruction without validating it
 *
 * @param instruction Transaction instruction to decode
 *
 * @return Decoded, non-validated instruction
 */
export function decodeInitializeMultisig2InstructionUnchecked({
    programId,
    keys: [account, ...signers],
    data,
}: TransactionInstruction): DecodedInitializeMultisig2InstructionUnchecked {
    return {
        programId,
        keys: {
            account,
            signers,
        },
        data: initializeMultisig2InstructionData.decode(data),
    };
}
