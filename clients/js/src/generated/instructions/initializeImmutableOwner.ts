/**
 * This code was AUTOGENERATED using the codama library.
 * Please DO NOT EDIT THIS FILE, instead use visitors
 * to add features, then rerun codama to update it.
 *
 * @see https://github.com/codama-idl/codama
 */

import {
  combineCodec,
  getStructDecoder,
  getStructEncoder,
  getU8Decoder,
  getU8Encoder,
  transformEncoder,
  type Address,
  type Codec,
  type Decoder,
  type Encoder,
  type IAccountMeta,
  type IInstruction,
  type IInstructionWithAccounts,
  type IInstructionWithData,
  type WritableAccount,
} from '@solana/kit';
import { TOKEN_2022_PROGRAM_ADDRESS } from '../programs';
import { getAccountMetaFactory, type ResolvedAccount } from '../shared';

export const INITIALIZE_IMMUTABLE_OWNER_DISCRIMINATOR = 22;

export function getInitializeImmutableOwnerDiscriminatorBytes() {
  return getU8Encoder().encode(INITIALIZE_IMMUTABLE_OWNER_DISCRIMINATOR);
}

export type InitializeImmutableOwnerInstruction<
  TProgram extends string = typeof TOKEN_2022_PROGRAM_ADDRESS,
  TAccountAccount extends string | IAccountMeta<string> = string,
  TRemainingAccounts extends readonly IAccountMeta<string>[] = [],
> = IInstruction<TProgram> &
  IInstructionWithData<Uint8Array> &
  IInstructionWithAccounts<
    [
      TAccountAccount extends string
        ? WritableAccount<TAccountAccount>
        : TAccountAccount,
      ...TRemainingAccounts,
    ]
  >;

export type InitializeImmutableOwnerInstructionData = { discriminator: number };

export type InitializeImmutableOwnerInstructionDataArgs = {};

export function getInitializeImmutableOwnerInstructionDataEncoder(): Encoder<InitializeImmutableOwnerInstructionDataArgs> {
  return transformEncoder(
    getStructEncoder([['discriminator', getU8Encoder()]]),
    (value) => ({
      ...value,
      discriminator: INITIALIZE_IMMUTABLE_OWNER_DISCRIMINATOR,
    })
  );
}

export function getInitializeImmutableOwnerInstructionDataDecoder(): Decoder<InitializeImmutableOwnerInstructionData> {
  return getStructDecoder([['discriminator', getU8Decoder()]]);
}

export function getInitializeImmutableOwnerInstructionDataCodec(): Codec<
  InitializeImmutableOwnerInstructionDataArgs,
  InitializeImmutableOwnerInstructionData
> {
  return combineCodec(
    getInitializeImmutableOwnerInstructionDataEncoder(),
    getInitializeImmutableOwnerInstructionDataDecoder()
  );
}

export type InitializeImmutableOwnerInput<
  TAccountAccount extends string = string,
> = {
  /** The account to initialize. */
  account: Address<TAccountAccount>;
};

export function getInitializeImmutableOwnerInstruction<
  TAccountAccount extends string,
  TProgramAddress extends Address = typeof TOKEN_2022_PROGRAM_ADDRESS,
>(
  input: InitializeImmutableOwnerInput<TAccountAccount>,
  config?: { programAddress?: TProgramAddress }
): InitializeImmutableOwnerInstruction<TProgramAddress, TAccountAccount> {
  // Program address.
  const programAddress = config?.programAddress ?? TOKEN_2022_PROGRAM_ADDRESS;

  // Original accounts.
  const originalAccounts = {
    account: { value: input.account ?? null, isWritable: true },
  };
  const accounts = originalAccounts as Record<
    keyof typeof originalAccounts,
    ResolvedAccount
  >;

  const getAccountMeta = getAccountMetaFactory(programAddress, 'programId');
  const instruction = {
    accounts: [getAccountMeta(accounts.account)],
    programAddress,
    data: getInitializeImmutableOwnerInstructionDataEncoder().encode({}),
  } as InitializeImmutableOwnerInstruction<TProgramAddress, TAccountAccount>;

  return instruction;
}

export type ParsedInitializeImmutableOwnerInstruction<
  TProgram extends string = typeof TOKEN_2022_PROGRAM_ADDRESS,
  TAccountMetas extends readonly IAccountMeta[] = readonly IAccountMeta[],
> = {
  programAddress: Address<TProgram>;
  accounts: {
    /** The account to initialize. */
    account: TAccountMetas[0];
  };
  data: InitializeImmutableOwnerInstructionData;
};

export function parseInitializeImmutableOwnerInstruction<
  TProgram extends string,
  TAccountMetas extends readonly IAccountMeta[],
>(
  instruction: IInstruction<TProgram> &
    IInstructionWithAccounts<TAccountMetas> &
    IInstructionWithData<Uint8Array>
): ParsedInitializeImmutableOwnerInstruction<TProgram, TAccountMetas> {
  if (instruction.accounts.length < 1) {
    // TODO: Coded error.
    throw new Error('Not enough accounts');
  }
  let accountIndex = 0;
  const getNextAccount = () => {
    const accountMeta = instruction.accounts![accountIndex]!;
    accountIndex += 1;
    return accountMeta;
  };
  return {
    programAddress: instruction.programAddress,
    accounts: {
      account: getNextAccount(),
    },
    data: getInitializeImmutableOwnerInstructionDataDecoder().decode(
      instruction.data
    ),
  };
}
