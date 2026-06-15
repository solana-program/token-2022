import { AccountMeta, Address, Instruction, InstructionWithData, ReadonlyUint8Array } from '@solana/kit';

import {
    BATCH_DISCRIMINATOR,
    BatchInstruction as GeneratedBatchInstruction,
    getBatchInstruction as generatedGetBatchInstruction,
    parseBatchInstruction as generatedParseBatchInstruction,
    ParsedBatchInstruction,
    ParsedToken2022Instruction,
    parseToken2022Instruction,
    TOKEN_2022_PROGRAM_ADDRESS,
} from './generated';

declare const nonBatchable: '__non_batchable:@solana-program/token-2022';

type BatchableInstruction<TProgramAddress extends string = string> = Instruction<TProgramAddress> & {
    readonly [nonBatchable]?: never;
};

export type BatchInstruction<
    TProgram extends string = typeof TOKEN_2022_PROGRAM_ADDRESS,
    TRemainingAccounts extends readonly AccountMeta<string>[] = [],
> = GeneratedBatchInstruction<TProgram, TRemainingAccounts> & { readonly [nonBatchable]: true };

export function getBatchInstruction<TProgramAddress extends Address = typeof TOKEN_2022_PROGRAM_ADDRESS>(
    instructions: BatchableInstruction<TProgramAddress>[],
    config?: { programAddress?: TProgramAddress },
): BatchInstruction<TProgramAddress, AccountMeta<string>[]> {
    const programAddress = config?.programAddress ?? TOKEN_2022_PROGRAM_ADDRESS;
    const hasNestedBatchInstruction = instructions.some(
        instruction => instruction.programAddress === programAddress && instruction.data?.[0] === BATCH_DISCRIMINATOR,
    );
    if (hasNestedBatchInstruction) {
        throw new Error('Batch instructions cannot be nested within other batch instructions.');
    }

    const accounts = instructions.flatMap(instruction => instruction.accounts ?? []);
    const data = instructions.map(instruction => ({
        numberOfAccounts: instruction.accounts?.length ?? 0,
        instructionData: instruction.data ?? new Uint8Array(),
    }));

    return Object.freeze({
        ...generatedGetBatchInstruction<TProgramAddress>({ data }, config),
        accounts,
    }) as BatchInstruction<TProgramAddress, AccountMeta<string>[]>;
}

export function parseBatchInstruction<TProgram extends string>(
    instruction: Instruction<TProgram> & InstructionWithData<ReadonlyUint8Array>,
): ParsedBatchInstruction<TProgram> & { instructions: ParsedToken2022Instruction<TProgram>[] } {
    const rawBatchInstruction = generatedParseBatchInstruction(instruction);
    let accountOffset = 0;
    const instructions = rawBatchInstruction.data.data.map(({ numberOfAccounts, instructionData }) => {
        const innerInstruction = parseToken2022Instruction<TProgram>({
            programAddress: instruction.programAddress,
            data: instructionData,
            accounts: instruction.accounts?.slice(accountOffset, accountOffset + numberOfAccounts) ?? [],
        });
        accountOffset += numberOfAccounts;
        return innerInstruction;
    });

    return { ...rawBatchInstruction, instructions };
}
