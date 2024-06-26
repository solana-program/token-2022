/**
 * This code was AUTOGENERATED using the kinobi library.
 * Please DO NOT EDIT THIS FILE, instead use visitors
 * to add features, then rerun kinobi to update it.
 *
 * @see https://github.com/kinobi-so/kinobi
 */

import { Address, containsBytes, getU8Encoder } from '@solana/web3.js';
import {
  ParsedCreateAssociatedTokenIdempotentInstruction,
  ParsedCreateAssociatedTokenInstruction,
  ParsedRecoverNestedAssociatedTokenInstruction,
} from '../instructions';

export const ASSOCIATED_TOKEN_PROGRAM_ADDRESS =
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL' as Address<'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'>;

export enum AssociatedTokenInstruction {
  CreateAssociatedToken,
  CreateAssociatedTokenIdempotent,
  RecoverNestedAssociatedToken,
}

export function identifyAssociatedTokenInstruction(
  instruction: { data: Uint8Array } | Uint8Array
): AssociatedTokenInstruction {
  const data =
    instruction instanceof Uint8Array ? instruction : instruction.data;
  if (containsBytes(data, getU8Encoder().encode(0), 0)) {
    return AssociatedTokenInstruction.CreateAssociatedToken;
  }
  if (containsBytes(data, getU8Encoder().encode(1), 0)) {
    return AssociatedTokenInstruction.CreateAssociatedTokenIdempotent;
  }
  if (containsBytes(data, getU8Encoder().encode(2), 0)) {
    return AssociatedTokenInstruction.RecoverNestedAssociatedToken;
  }
  throw new Error(
    'The provided instruction could not be identified as a associatedToken instruction.'
  );
}

export type ParsedAssociatedTokenInstruction<
  TProgram extends string = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
> =
  | ({
      instructionType: AssociatedTokenInstruction.CreateAssociatedToken;
    } & ParsedCreateAssociatedTokenInstruction<TProgram>)
  | ({
      instructionType: AssociatedTokenInstruction.CreateAssociatedTokenIdempotent;
    } & ParsedCreateAssociatedTokenIdempotentInstruction<TProgram>)
  | ({
      instructionType: AssociatedTokenInstruction.RecoverNestedAssociatedToken;
    } & ParsedRecoverNestedAssociatedTokenInstruction<TProgram>);
