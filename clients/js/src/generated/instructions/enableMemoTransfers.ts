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
} from '@solana/kit';
import { TOKEN_2022_PROGRAM_ADDRESS } from '../programs';
import { getAccountMetaFactory, type ResolvedAccount } from '../shared';

export const ENABLE_MEMO_TRANSFERS_DISCRIMINATOR = 30;

export function getEnableMemoTransfersDiscriminatorBytes() {
  return getU8Encoder().encode(ENABLE_MEMO_TRANSFERS_DISCRIMINATOR);
}

export const ENABLE_MEMO_TRANSFERS_MEMO_TRANSFERS_DISCRIMINATOR = 0;

export function getEnableMemoTransfersMemoTransfersDiscriminatorBytes() {
  return getU8Encoder().encode(
    ENABLE_MEMO_TRANSFERS_MEMO_TRANSFERS_DISCRIMINATOR
  );
}

export type EnableMemoTransfersInstruction<
  TProgram extends string = typeof TOKEN_2022_PROGRAM_ADDRESS,
  TAccountToken extends string | IAccountMeta<string> = string,
  TAccountOwner extends string | IAccountMeta<string> = string,
  TRemainingAccounts extends readonly IAccountMeta<string>[] = [],
> = IInstruction<TProgram> &
  IInstructionWithData<Uint8Array> &
  IInstructionWithAccounts<
    [
      TAccountToken extends string
        ? WritableAccount<TAccountToken>
        : TAccountToken,
      TAccountOwner extends string
        ? ReadonlyAccount<TAccountOwner>
        : TAccountOwner,
      ...TRemainingAccounts,
    ]
  >;

export type EnableMemoTransfersInstructionData = {
  discriminator: number;
  memoTransfersDiscriminator: number;
};

export type EnableMemoTransfersInstructionDataArgs = {};

export function getEnableMemoTransfersInstructionDataEncoder(): Encoder<EnableMemoTransfersInstructionDataArgs> {
  return transformEncoder(
    getStructEncoder([
      ['discriminator', getU8Encoder()],
      ['memoTransfersDiscriminator', getU8Encoder()],
    ]),
    (value) => ({
      ...value,
      discriminator: ENABLE_MEMO_TRANSFERS_DISCRIMINATOR,
      memoTransfersDiscriminator:
        ENABLE_MEMO_TRANSFERS_MEMO_TRANSFERS_DISCRIMINATOR,
    })
  );
}

export function getEnableMemoTransfersInstructionDataDecoder(): Decoder<EnableMemoTransfersInstructionData> {
  return getStructDecoder([
    ['discriminator', getU8Decoder()],
    ['memoTransfersDiscriminator', getU8Decoder()],
  ]);
}

export function getEnableMemoTransfersInstructionDataCodec(): Codec<
  EnableMemoTransfersInstructionDataArgs,
  EnableMemoTransfersInstructionData
> {
  return combineCodec(
    getEnableMemoTransfersInstructionDataEncoder(),
    getEnableMemoTransfersInstructionDataDecoder()
  );
}

export type EnableMemoTransfersInput<
  TAccountToken extends string = string,
  TAccountOwner extends string = string,
> = {
  /** The token account to update. */
  token: Address<TAccountToken>;
  /** The account's owner or its multisignature account. */
  owner: Address<TAccountOwner> | TransactionSigner<TAccountOwner>;
  multiSigners?: Array<TransactionSigner>;
};

export function getEnableMemoTransfersInstruction<
  TAccountToken extends string,
  TAccountOwner extends string,
  TProgramAddress extends Address = typeof TOKEN_2022_PROGRAM_ADDRESS,
>(
  input: EnableMemoTransfersInput<TAccountToken, TAccountOwner>,
  config?: { programAddress?: TProgramAddress }
): EnableMemoTransfersInstruction<
  TProgramAddress,
  TAccountToken,
  (typeof input)['owner'] extends TransactionSigner<TAccountOwner>
    ? ReadonlySignerAccount<TAccountOwner> & IAccountSignerMeta<TAccountOwner>
    : TAccountOwner
> {
  // Program address.
  const programAddress = config?.programAddress ?? TOKEN_2022_PROGRAM_ADDRESS;

  // Original accounts.
  const originalAccounts = {
    token: { value: input.token ?? null, isWritable: true },
    owner: { value: input.owner ?? null, isWritable: false },
  };
  const accounts = originalAccounts as Record<
    keyof typeof originalAccounts,
    ResolvedAccount
  >;

  // Original args.
  const args = { ...input };

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
      getAccountMeta(accounts.owner),
      ...remainingAccounts,
    ],
    programAddress,
    data: getEnableMemoTransfersInstructionDataEncoder().encode({}),
  } as EnableMemoTransfersInstruction<
    TProgramAddress,
    TAccountToken,
    (typeof input)['owner'] extends TransactionSigner<TAccountOwner>
      ? ReadonlySignerAccount<TAccountOwner> & IAccountSignerMeta<TAccountOwner>
      : TAccountOwner
  >;

  return instruction;
}

export type ParsedEnableMemoTransfersInstruction<
  TProgram extends string = typeof TOKEN_2022_PROGRAM_ADDRESS,
  TAccountMetas extends readonly IAccountMeta[] = readonly IAccountMeta[],
> = {
  programAddress: Address<TProgram>;
  accounts: {
    /** The token account to update. */
    token: TAccountMetas[0];
    /** The account's owner or its multisignature account. */
    owner: TAccountMetas[1];
  };
  data: EnableMemoTransfersInstructionData;
};

export function parseEnableMemoTransfersInstruction<
  TProgram extends string,
  TAccountMetas extends readonly IAccountMeta[],
>(
  instruction: IInstruction<TProgram> &
    IInstructionWithAccounts<TAccountMetas> &
    IInstructionWithData<Uint8Array>
): ParsedEnableMemoTransfersInstruction<TProgram, TAccountMetas> {
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
      token: getNextAccount(),
      owner: getNextAccount(),
    },
    data: getEnableMemoTransfersInstructionDataDecoder().decode(
      instruction.data
    ),
  };
}
