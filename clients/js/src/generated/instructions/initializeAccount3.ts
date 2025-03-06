/**
 * This code was AUTOGENERATED using the codama library.
 * Please DO NOT EDIT THIS FILE, instead use visitors
 * to add features, then rerun codama to update it.
 *
 * @see https://github.com/codama-idl/codama
 */

import {
  combineCodec,
  getAddressDecoder,
  getAddressEncoder,
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
  type ReadonlyAccount,
  type WritableAccount,
} from '@solana/kit';
import { TOKEN_2022_PROGRAM_ADDRESS } from '../programs';
import { getAccountMetaFactory, type ResolvedAccount } from '../shared';

export const INITIALIZE_ACCOUNT3_DISCRIMINATOR = 18;

export function getInitializeAccount3DiscriminatorBytes() {
  return getU8Encoder().encode(INITIALIZE_ACCOUNT3_DISCRIMINATOR);
}

export type InitializeAccount3Instruction<
  TProgram extends string = typeof TOKEN_2022_PROGRAM_ADDRESS,
  TAccountAccount extends string | IAccountMeta<string> = string,
  TAccountMint extends string | IAccountMeta<string> = string,
  TRemainingAccounts extends readonly IAccountMeta<string>[] = [],
> = IInstruction<TProgram> &
  IInstructionWithData<Uint8Array> &
  IInstructionWithAccounts<
    [
      TAccountAccount extends string
        ? WritableAccount<TAccountAccount>
        : TAccountAccount,
      TAccountMint extends string
        ? ReadonlyAccount<TAccountMint>
        : TAccountMint,
      ...TRemainingAccounts,
    ]
  >;

export type InitializeAccount3InstructionData = {
  discriminator: number;
  /** The new account's owner/multisignature. */
  owner: Address;
};

export type InitializeAccount3InstructionDataArgs = {
  /** The new account's owner/multisignature. */
  owner: Address;
};

export function getInitializeAccount3InstructionDataEncoder(): Encoder<InitializeAccount3InstructionDataArgs> {
  return transformEncoder(
    getStructEncoder([
      ['discriminator', getU8Encoder()],
      ['owner', getAddressEncoder()],
    ]),
    (value) => ({ ...value, discriminator: INITIALIZE_ACCOUNT3_DISCRIMINATOR })
  );
}

export function getInitializeAccount3InstructionDataDecoder(): Decoder<InitializeAccount3InstructionData> {
  return getStructDecoder([
    ['discriminator', getU8Decoder()],
    ['owner', getAddressDecoder()],
  ]);
}

export function getInitializeAccount3InstructionDataCodec(): Codec<
  InitializeAccount3InstructionDataArgs,
  InitializeAccount3InstructionData
> {
  return combineCodec(
    getInitializeAccount3InstructionDataEncoder(),
    getInitializeAccount3InstructionDataDecoder()
  );
}

export type InitializeAccount3Input<
  TAccountAccount extends string = string,
  TAccountMint extends string = string,
> = {
  /** The account to initialize. */
  account: Address<TAccountAccount>;
  /** The mint this account will be associated with. */
  mint: Address<TAccountMint>;
  owner: InitializeAccount3InstructionDataArgs['owner'];
};

export function getInitializeAccount3Instruction<
  TAccountAccount extends string,
  TAccountMint extends string,
  TProgramAddress extends Address = typeof TOKEN_2022_PROGRAM_ADDRESS,
>(
  input: InitializeAccount3Input<TAccountAccount, TAccountMint>,
  config?: { programAddress?: TProgramAddress }
): InitializeAccount3Instruction<
  TProgramAddress,
  TAccountAccount,
  TAccountMint
> {
  // Program address.
  const programAddress = config?.programAddress ?? TOKEN_2022_PROGRAM_ADDRESS;

  // Original accounts.
  const originalAccounts = {
    account: { value: input.account ?? null, isWritable: true },
    mint: { value: input.mint ?? null, isWritable: false },
  };
  const accounts = originalAccounts as Record<
    keyof typeof originalAccounts,
    ResolvedAccount
  >;

  // Original args.
  const args = { ...input };

  const getAccountMeta = getAccountMetaFactory(programAddress, 'programId');
  const instruction = {
    accounts: [getAccountMeta(accounts.account), getAccountMeta(accounts.mint)],
    programAddress,
    data: getInitializeAccount3InstructionDataEncoder().encode(
      args as InitializeAccount3InstructionDataArgs
    ),
  } as InitializeAccount3Instruction<
    TProgramAddress,
    TAccountAccount,
    TAccountMint
  >;

  return instruction;
}

export type ParsedInitializeAccount3Instruction<
  TProgram extends string = typeof TOKEN_2022_PROGRAM_ADDRESS,
  TAccountMetas extends readonly IAccountMeta[] = readonly IAccountMeta[],
> = {
  programAddress: Address<TProgram>;
  accounts: {
    /** The account to initialize. */
    account: TAccountMetas[0];
    /** The mint this account will be associated with. */
    mint: TAccountMetas[1];
  };
  data: InitializeAccount3InstructionData;
};

export function parseInitializeAccount3Instruction<
  TProgram extends string,
  TAccountMetas extends readonly IAccountMeta[],
>(
  instruction: IInstruction<TProgram> &
    IInstructionWithAccounts<TAccountMetas> &
    IInstructionWithData<Uint8Array>
): ParsedInitializeAccount3Instruction<TProgram, TAccountMetas> {
  if (instruction.accounts.length < 2) {
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
      mint: getNextAccount(),
    },
    data: getInitializeAccount3InstructionDataDecoder().decode(
      instruction.data
    ),
  };
}
