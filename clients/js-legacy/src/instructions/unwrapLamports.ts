import { struct, u8 } from '@solana/buffer-layout';
import type { AccountMeta, PublicKey, Signer } from '@solana/web3.js';
import { TransactionInstruction } from '@solana/web3.js';
import {
    TokenInvalidInstructionDataError,
    TokenInvalidInstructionKeysError,
    TokenInvalidInstructionProgramError,
    TokenInvalidInstructionTypeError,
} from '../errors.js';
import { addSigners } from './internal.js';
import { TokenInstruction } from './types.js';
import { COptionU64Layout } from '../serialization.js';

/** TODO: docs */
export interface UnwrapLamportsInstructionData {
    instruction: TokenInstruction.UnwrapLamports;
    amount: bigint | null;
}

/** TODO: docs */
export const unwrapLamportsInstructionData = struct<UnwrapLamportsInstructionData>([
    u8('instruction'),
    new COptionU64Layout('amount'),
]);

/**
 * Construct a UnwrapLamports instruction
 *
 * @param source       Native source account
 * @param destination  Account receiving the lamports
 * @param owner        Owner of the source account
 * @param amount       Amount of lamports to unwrap
 * @param multiSigners Signing accounts if `owner` is a multisig
 * @param programId    SPL Token program account
 *
 * @return Instruction to add to a transaction
 */
export function createUnwrapLamportsInstruction(
    source: PublicKey,
    destination: PublicKey,
    owner: PublicKey,
    amount: bigint | null,
    multiSigners: (Signer | PublicKey)[] = [],
    programId: PublicKey,
): TransactionInstruction {
    const keys = addSigners(
        [
            { pubkey: source, isSigner: false, isWritable: true },
            { pubkey: destination, isSigner: false, isWritable: true },
        ],
        owner,
        multiSigners,
    );

    const data = Buffer.alloc(10); // worst-case
    unwrapLamportsInstructionData.encode(
        {
            instruction: TokenInstruction.UnwrapLamports,
            amount,
        },
        data,
    );

    return new TransactionInstruction({ keys, programId, data });
}

/** A decoded, valid UnwrapLamports instruction */
export interface DecodedUnwrapLamportsInstruction {
    programId: PublicKey;
    keys: {
        source: AccountMeta;
        destination: AccountMeta;
        owner: AccountMeta;
        multiSigners: AccountMeta[];
    };
    data: {
        instruction: TokenInstruction.UnwrapLamports;
        amount: bigint | null;
    };
}

/**
 * Decode a UnwrapLamports instruction and validate it
 *
 * @param instruction Transaction instruction to decode
 * @param programId   SPL Token program account
 *
 * @return Decoded, valid instruction
 */
export function decodeUnwrapLamportsInstruction(
    instruction: TransactionInstruction,
    programId: PublicKey,
): DecodedUnwrapLamportsInstruction {
    if (!instruction.programId.equals(programId)) throw new TokenInvalidInstructionProgramError();
    if (instruction.data.length !== unwrapLamportsInstructionData.span) throw new TokenInvalidInstructionDataError();

    const {
        keys: { source, destination, owner, multiSigners },
        data,
    } = decodeUnwrapLamportsInstructionUnchecked(instruction);
    if (data.instruction !== TokenInstruction.UnwrapLamports) throw new TokenInvalidInstructionTypeError();
    if (!source || !destination || !owner) throw new TokenInvalidInstructionKeysError();

    return {
        programId,
        keys: {
            source,
            destination,
            owner,
            multiSigners,
        },
        data,
    };
}

/** A decoded, non-validated UnwrapLamports instruction */
export interface DecodedUnwrapLamportsInstructionUnchecked {
    programId: PublicKey;
    keys: {
        source: AccountMeta | undefined;
        destination: AccountMeta | undefined;
        owner: AccountMeta | undefined;
        multiSigners: AccountMeta[];
    };
    data: {
        instruction: number;
        amount: bigint | null;
    };
}

/**
 * Decode a UnwrapLamports instruction without validating it
 *
 * @param instruction Transaction instruction to decode
 *
 * @return Decoded, non-validated instruction
 */
export function decodeUnwrapLamportsInstructionUnchecked({
    programId,
    keys: [source, destination, owner, ...multiSigners],
    data,
}: TransactionInstruction): DecodedUnwrapLamportsInstructionUnchecked {
    return {
        programId,
        keys: {
            source,
            destination,
            owner,
            multiSigners,
        },
        data: unwrapLamportsInstructionData.decode(data),
    };
}
