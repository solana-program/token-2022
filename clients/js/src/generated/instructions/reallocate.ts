/**
 * This code was AUTOGENERATED using the codama library.
 * Please DO NOT EDIT THIS FILE, instead use visitors
 * to add features, then rerun codama to update it.
 *
 * @see https://github.com/codama-idl/codama
 */

import {
  AccountRole,
  combineCodec,
  getArrayDecoder,
  getArrayEncoder,
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
  type IAccountSignerMeta,
  type IInstruction,
  type IInstructionWithAccounts,
  type IInstructionWithData,
  type ReadonlyAccount,
  type ReadonlySignerAccount,
  type TransactionSigner,
  type WritableAccount,
  type WritableSignerAccount,
} from '@solana/kit';
import { TOKEN_2022_PROGRAM_ADDRESS } from '../programs';
import { getAccountMetaFactory, type ResolvedAccount } from '../shared';
import {
  getExtensionTypeDecoder,
  getExtensionTypeEncoder,
  type ExtensionType,
  type ExtensionTypeArgs,
} from '../types';

export const REALLOCATE_DISCRIMINATOR = 29;

export function getReallocateDiscriminatorBytes() {
  return getU8Encoder().encode(REALLOCATE_DISCRIMINATOR);
}

export type ReallocateInstruction<
  TProgram extends string = typeof TOKEN_2022_PROGRAM_ADDRESS,
  TAccountToken extends string | IAccountMeta<string> = string,
  TAccountPayer extends string | IAccountMeta<string> = string,
  TAccountSystemProgram extends
    | string
    | IAccountMeta<string> = '11111111111111111111111111111111',
  TAccountOwner extends string | IAccountMeta<string> = string,
  TRemainingAccounts extends readonly IAccountMeta<string>[] = [],
> = IInstruction<TProgram> &
  IInstructionWithData<Uint8Array> &
  IInstructionWithAccounts<
    [
      TAccountToken extends string
        ? WritableAccount<TAccountToken>
        : TAccountToken,
      TAccountPayer extends string
        ? WritableSignerAccount<TAccountPayer> &
            IAccountSignerMeta<TAccountPayer>
        : TAccountPayer,
      TAccountSystemProgram extends string
        ? ReadonlyAccount<TAccountSystemProgram>
        : TAccountSystemProgram,
      TAccountOwner extends string
        ? ReadonlyAccount<TAccountOwner>
        : TAccountOwner,
      ...TRemainingAccounts,
    ]
  >;

export type ReallocateInstructionData = {
  discriminator: number;
  /** New extension types to include in the reallocated account. */
  newExtensionTypes: Array<ExtensionType>;
};

export type ReallocateInstructionDataArgs = {
  /** New extension types to include in the reallocated account. */
  newExtensionTypes: Array<ExtensionTypeArgs>;
};

export function getReallocateInstructionDataEncoder(): Encoder<ReallocateInstructionDataArgs> {
  return transformEncoder(
    getStructEncoder([
      ['discriminator', getU8Encoder()],
      [
        'newExtensionTypes',
        getArrayEncoder(getExtensionTypeEncoder(), { size: 'remainder' }),
      ],
    ]),
    (value) => ({ ...value, discriminator: REALLOCATE_DISCRIMINATOR })
  );
}

export function getReallocateInstructionDataDecoder(): Decoder<ReallocateInstructionData> {
  return getStructDecoder([
    ['discriminator', getU8Decoder()],
    [
      'newExtensionTypes',
      getArrayDecoder(getExtensionTypeDecoder(), { size: 'remainder' }),
    ],
  ]);
}

export function getReallocateInstructionDataCodec(): Codec<
  ReallocateInstructionDataArgs,
  ReallocateInstructionData
> {
  return combineCodec(
    getReallocateInstructionDataEncoder(),
    getReallocateInstructionDataDecoder()
  );
}

export type ReallocateInput<
  TAccountToken extends string = string,
  TAccountPayer extends string = string,
  TAccountSystemProgram extends string = string,
  TAccountOwner extends string = string,
> = {
  /** The token account to reallocate. */
  token: Address<TAccountToken>;
  /** The payer account to fund reallocation. */
  payer: TransactionSigner<TAccountPayer>;
  /** System program for reallocation funding. */
  systemProgram?: Address<TAccountSystemProgram>;
  /** The account's owner or its multisignature account. */
  owner: Address<TAccountOwner> | TransactionSigner<TAccountOwner>;
  newExtensionTypes: ReallocateInstructionDataArgs['newExtensionTypes'];
  multiSigners?: Array<TransactionSigner>;
};

export function getReallocateInstruction<
  TAccountToken extends string,
  TAccountPayer extends string,
  TAccountSystemProgram extends string,
  TAccountOwner extends string,
  TProgramAddress extends Address = typeof TOKEN_2022_PROGRAM_ADDRESS,
>(
  input: ReallocateInput<
    TAccountToken,
    TAccountPayer,
    TAccountSystemProgram,
    TAccountOwner
  >,
  config?: { programAddress?: TProgramAddress }
): ReallocateInstruction<
  TProgramAddress,
  TAccountToken,
  TAccountPayer,
  TAccountSystemProgram,
  (typeof input)['owner'] extends TransactionSigner<TAccountOwner>
    ? ReadonlySignerAccount<TAccountOwner> & IAccountSignerMeta<TAccountOwner>
    : TAccountOwner
> {
  // Program address.
  const programAddress = config?.programAddress ?? TOKEN_2022_PROGRAM_ADDRESS;

  // Original accounts.
  const originalAccounts = {
    token: { value: input.token ?? null, isWritable: true },
    payer: { value: input.payer ?? null, isWritable: true },
    systemProgram: { value: input.systemProgram ?? null, isWritable: false },
    owner: { value: input.owner ?? null, isWritable: false },
  };
  const accounts = originalAccounts as Record<
    keyof typeof originalAccounts,
    ResolvedAccount
  >;

  // Original args.
  const args = { ...input };

  // Resolve default values.
  if (!accounts.systemProgram.value) {
    accounts.systemProgram.value =
      '11111111111111111111111111111111' as Address<'11111111111111111111111111111111'>;
  }

  // Remaining accounts.
  const remainingAccounts: IAccountMeta[] = (args.multiSigners ?? []).map(
    (signer) => ({
      address: signer.address,
      role: AccountRole.READONLY_SIGNER,
      signer,
    })
  );

  const getAccountMeta = getAccountMetaFactory(programAddress, 'programId');
  const instruction = {
    accounts: [
      getAccountMeta(accounts.token),
      getAccountMeta(accounts.payer),
      getAccountMeta(accounts.systemProgram),
      getAccountMeta(accounts.owner),
      ...remainingAccounts,
    ],
    programAddress,
    data: getReallocateInstructionDataEncoder().encode(
      args as ReallocateInstructionDataArgs
    ),
  } as ReallocateInstruction<
    TProgramAddress,
    TAccountToken,
    TAccountPayer,
    TAccountSystemProgram,
    (typeof input)['owner'] extends TransactionSigner<TAccountOwner>
      ? ReadonlySignerAccount<TAccountOwner> & IAccountSignerMeta<TAccountOwner>
      : TAccountOwner
  >;

  return instruction;
}

export type ParsedReallocateInstruction<
  TProgram extends string = typeof TOKEN_2022_PROGRAM_ADDRESS,
  TAccountMetas extends readonly IAccountMeta[] = readonly IAccountMeta[],
> = {
  programAddress: Address<TProgram>;
  accounts: {
    /** The token account to reallocate. */
    token: TAccountMetas[0];
    /** The payer account to fund reallocation. */
    payer: TAccountMetas[1];
    /** System program for reallocation funding. */
    systemProgram: TAccountMetas[2];
    /** The account's owner or its multisignature account. */
    owner: TAccountMetas[3];
  };
  data: ReallocateInstructionData;
};

export function parseReallocateInstruction<
  TProgram extends string,
  TAccountMetas extends readonly IAccountMeta[],
>(
  instruction: IInstruction<TProgram> &
    IInstructionWithAccounts<TAccountMetas> &
    IInstructionWithData<Uint8Array>
): ParsedReallocateInstruction<TProgram, TAccountMetas> {
  if (instruction.accounts.length < 4) {
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
      token: getNextAccount(),
      payer: getNextAccount(),
      systemProgram: getNextAccount(),
      owner: getNextAccount(),
    },
    data: getReallocateInstructionDataDecoder().decode(instruction.data),
  };
}
