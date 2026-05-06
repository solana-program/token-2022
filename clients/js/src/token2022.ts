import {
    assertIsInstructionWithAccounts,
    type Instruction,
    type InstructionWithData,
    type ReadonlyUint8Array,
} from '@solana/kit';
import {
    identifyToken2022Instruction,
    parseToken2022Instruction as parseGeneratedToken2022Instruction,
    Token2022Instruction,
    type ParsedToken2022Instruction as GeneratedParsedToken2022Instruction,
} from './generated/programs/token2022';
import {
    parseConfidentialTransferInstruction,
    type ParsedConfidentialTransferInstruction,
} from './confidentialTransfer';
import {
    parseConfidentialTransferWithFeeInstruction,
    type ParsedConfidentialTransferWithFeeInstruction,
} from './confidentialTransferWithFee';
import {
    parseConfidentialWithdrawInstruction,
    type ParsedConfidentialWithdrawInstruction,
} from './confidentialWithdraw';
import {
    parseConfigureConfidentialTransferAccountInstruction,
    type ParsedConfigureConfidentialTransferAccountInstruction,
} from './configureConfidentialTransferAccount';
import {
    parseEmptyConfidentialTransferAccountInstruction,
    type ParsedEmptyConfidentialTransferAccountInstruction,
} from './emptyConfidentialTransferAccount';

export {
    identifyToken2022Account,
    identifyToken2022Instruction,
    TOKEN_2022_PROGRAM_ADDRESS,
    Token2022Account,
    Token2022Instruction,
} from './generated/programs/token2022';

type ConfidentialTransferInstructionOverride<TProgram extends string> =
    | ({
          instructionType: Token2022Instruction.ConfigureConfidentialTransferAccount;
      } & ParsedConfigureConfidentialTransferAccountInstruction<TProgram>)
    | ({
          instructionType: Token2022Instruction.EmptyConfidentialTransferAccount;
      } & ParsedEmptyConfidentialTransferAccountInstruction<TProgram>)
    | ({ instructionType: Token2022Instruction.ConfidentialWithdraw } & ParsedConfidentialWithdrawInstruction<TProgram>)
    | ({ instructionType: Token2022Instruction.ConfidentialTransfer } & ParsedConfidentialTransferInstruction<TProgram>)
    | ({
          instructionType: Token2022Instruction.ConfidentialTransferWithFee;
      } & ParsedConfidentialTransferWithFeeInstruction<TProgram>);

export type ParsedToken2022Instruction<TProgram extends string = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'> =
    | Exclude<GeneratedParsedToken2022Instruction<TProgram>, ConfidentialTransferInstructionOverride<TProgram>>
    | ConfidentialTransferInstructionOverride<TProgram>;

export function parseToken2022Instruction<TProgram extends string>(
    instruction: Instruction<TProgram> & InstructionWithData<ReadonlyUint8Array>,
): ParsedToken2022Instruction<TProgram> {
    const instructionType = identifyToken2022Instruction(instruction);
    switch (instructionType) {
        case Token2022Instruction.ConfigureConfidentialTransferAccount: {
            assertIsInstructionWithAccounts(instruction);
            return {
                instructionType: Token2022Instruction.ConfigureConfidentialTransferAccount,
                ...parseConfigureConfidentialTransferAccountInstruction(instruction),
            };
        }
        case Token2022Instruction.EmptyConfidentialTransferAccount: {
            assertIsInstructionWithAccounts(instruction);
            return {
                instructionType: Token2022Instruction.EmptyConfidentialTransferAccount,
                ...parseEmptyConfidentialTransferAccountInstruction(instruction),
            };
        }
        case Token2022Instruction.ConfidentialWithdraw: {
            assertIsInstructionWithAccounts(instruction);
            return {
                instructionType: Token2022Instruction.ConfidentialWithdraw,
                ...parseConfidentialWithdrawInstruction(instruction),
            };
        }
        case Token2022Instruction.ConfidentialTransfer: {
            assertIsInstructionWithAccounts(instruction);
            return {
                instructionType: Token2022Instruction.ConfidentialTransfer,
                ...parseConfidentialTransferInstruction(instruction),
            };
        }
        case Token2022Instruction.ConfidentialTransferWithFee: {
            assertIsInstructionWithAccounts(instruction);
            return {
                instructionType: Token2022Instruction.ConfidentialTransferWithFee,
                ...parseConfidentialTransferWithFeeInstruction(instruction),
            };
        }
        default:
            return parseGeneratedToken2022Instruction(instruction) as ParsedToken2022Instruction<TProgram>;
    }
}
