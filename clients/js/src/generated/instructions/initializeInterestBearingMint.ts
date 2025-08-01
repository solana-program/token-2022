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
  getI16Decoder,
  getI16Encoder,
  getOptionDecoder,
  getOptionEncoder,
  getStructDecoder,
  getStructEncoder,
  getU8Decoder,
  getU8Encoder,
  transformEncoder,
  type AccountMeta,
  type Address,
  type FixedSizeCodec,
  type FixedSizeDecoder,
  type FixedSizeEncoder,
  type Instruction,
  type InstructionWithAccounts,
  type InstructionWithData,
  type Option,
  type OptionOrNullable,
  type ReadonlyUint8Array,
  type WritableAccount,
} from '@solana/kit';
import { TOKEN_2022_PROGRAM_ADDRESS } from '../programs';
import { getAccountMetaFactory, type ResolvedAccount } from '../shared';

export const INITIALIZE_INTEREST_BEARING_MINT_DISCRIMINATOR = 33;

export function getInitializeInterestBearingMintDiscriminatorBytes() {
  return getU8Encoder().encode(INITIALIZE_INTEREST_BEARING_MINT_DISCRIMINATOR);
}

export const INITIALIZE_INTEREST_BEARING_MINT_INTEREST_BEARING_MINT_DISCRIMINATOR = 0;

export function getInitializeInterestBearingMintInterestBearingMintDiscriminatorBytes() {
  return getU8Encoder().encode(
    INITIALIZE_INTEREST_BEARING_MINT_INTEREST_BEARING_MINT_DISCRIMINATOR
  );
}

export type InitializeInterestBearingMintInstruction<
  TProgram extends string = typeof TOKEN_2022_PROGRAM_ADDRESS,
  TAccountMint extends string | AccountMeta<string> = string,
  TRemainingAccounts extends readonly AccountMeta<string>[] = [],
> = Instruction<TProgram> &
  InstructionWithData<ReadonlyUint8Array> &
  InstructionWithAccounts<
    [
      TAccountMint extends string
        ? WritableAccount<TAccountMint>
        : TAccountMint,
      ...TRemainingAccounts,
    ]
  >;

export type InitializeInterestBearingMintInstructionData = {
  discriminator: number;
  interestBearingMintDiscriminator: number;
  /** The public key for the account that can update the rate */
  rateAuthority: Option<Address>;
  /** The initial interest rate */
  rate: number;
};

export type InitializeInterestBearingMintInstructionDataArgs = {
  /** The public key for the account that can update the rate */
  rateAuthority: OptionOrNullable<Address>;
  /** The initial interest rate */
  rate: number;
};

export function getInitializeInterestBearingMintInstructionDataEncoder(): FixedSizeEncoder<InitializeInterestBearingMintInstructionDataArgs> {
  return transformEncoder(
    getStructEncoder([
      ['discriminator', getU8Encoder()],
      ['interestBearingMintDiscriminator', getU8Encoder()],
      [
        'rateAuthority',
        getOptionEncoder(getAddressEncoder(), {
          prefix: null,
          noneValue: 'zeroes',
        }),
      ],
      ['rate', getI16Encoder()],
    ]),
    (value) => ({
      ...value,
      discriminator: INITIALIZE_INTEREST_BEARING_MINT_DISCRIMINATOR,
      interestBearingMintDiscriminator:
        INITIALIZE_INTEREST_BEARING_MINT_INTEREST_BEARING_MINT_DISCRIMINATOR,
    })
  );
}

export function getInitializeInterestBearingMintInstructionDataDecoder(): FixedSizeDecoder<InitializeInterestBearingMintInstructionData> {
  return getStructDecoder([
    ['discriminator', getU8Decoder()],
    ['interestBearingMintDiscriminator', getU8Decoder()],
    [
      'rateAuthority',
      getOptionDecoder(getAddressDecoder(), {
        prefix: null,
        noneValue: 'zeroes',
      }),
    ],
    ['rate', getI16Decoder()],
  ]);
}

export function getInitializeInterestBearingMintInstructionDataCodec(): FixedSizeCodec<
  InitializeInterestBearingMintInstructionDataArgs,
  InitializeInterestBearingMintInstructionData
> {
  return combineCodec(
    getInitializeInterestBearingMintInstructionDataEncoder(),
    getInitializeInterestBearingMintInstructionDataDecoder()
  );
}

export type InitializeInterestBearingMintInput<
  TAccountMint extends string = string,
> = {
  /** The mint to initialize. */
  mint: Address<TAccountMint>;
  rateAuthority: InitializeInterestBearingMintInstructionDataArgs['rateAuthority'];
  rate: InitializeInterestBearingMintInstructionDataArgs['rate'];
};

export function getInitializeInterestBearingMintInstruction<
  TAccountMint extends string,
  TProgramAddress extends Address = typeof TOKEN_2022_PROGRAM_ADDRESS,
>(
  input: InitializeInterestBearingMintInput<TAccountMint>,
  config?: { programAddress?: TProgramAddress }
): InitializeInterestBearingMintInstruction<TProgramAddress, TAccountMint> {
  // Program address.
  const programAddress = config?.programAddress ?? TOKEN_2022_PROGRAM_ADDRESS;

  // Original accounts.
  const originalAccounts = {
    mint: { value: input.mint ?? null, isWritable: true },
  };
  const accounts = originalAccounts as Record<
    keyof typeof originalAccounts,
    ResolvedAccount
  >;

  // Original args.
  const args = { ...input };

  const getAccountMeta = getAccountMetaFactory(programAddress, 'programId');
  const instruction = {
    accounts: [getAccountMeta(accounts.mint)],
    programAddress,
    data: getInitializeInterestBearingMintInstructionDataEncoder().encode(
      args as InitializeInterestBearingMintInstructionDataArgs
    ),
  } as InitializeInterestBearingMintInstruction<TProgramAddress, TAccountMint>;

  return instruction;
}

export type ParsedInitializeInterestBearingMintInstruction<
  TProgram extends string = typeof TOKEN_2022_PROGRAM_ADDRESS,
  TAccountMetas extends readonly AccountMeta[] = readonly AccountMeta[],
> = {
  programAddress: Address<TProgram>;
  accounts: {
    /** The mint to initialize. */
    mint: TAccountMetas[0];
  };
  data: InitializeInterestBearingMintInstructionData;
};

export function parseInitializeInterestBearingMintInstruction<
  TProgram extends string,
  TAccountMetas extends readonly AccountMeta[],
>(
  instruction: Instruction<TProgram> &
    InstructionWithAccounts<TAccountMetas> &
    InstructionWithData<ReadonlyUint8Array>
): ParsedInitializeInterestBearingMintInstruction<TProgram, TAccountMetas> {
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
      mint: getNextAccount(),
    },
    data: getInitializeInterestBearingMintInstructionDataDecoder().decode(
      instruction.data
    ),
  };
}
