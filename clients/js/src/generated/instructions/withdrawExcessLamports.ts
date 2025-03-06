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

export const WITHDRAW_EXCESS_LAMPORTS_DISCRIMINATOR = 38;

export function getWithdrawExcessLamportsDiscriminatorBytes() {
  return getU8Encoder().encode(WITHDRAW_EXCESS_LAMPORTS_DISCRIMINATOR);
}

export type WithdrawExcessLamportsInstruction<
  TProgram extends string = typeof TOKEN_2022_PROGRAM_ADDRESS,
  TAccountSourceAccount extends string | IAccountMeta<string> = string,
  TAccountDestinationAccount extends string | IAccountMeta<string> = string,
  TAccountAuthority extends string | IAccountMeta<string> = string,
  TRemainingAccounts extends readonly IAccountMeta<string>[] = [],
> = IInstruction<TProgram> &
  IInstructionWithData<Uint8Array> &
  IInstructionWithAccounts<
    [
      TAccountSourceAccount extends string
        ? WritableAccount<TAccountSourceAccount>
        : TAccountSourceAccount,
      TAccountDestinationAccount extends string
        ? WritableAccount<TAccountDestinationAccount>
        : TAccountDestinationAccount,
      TAccountAuthority extends string
        ? ReadonlyAccount<TAccountAuthority>
        : TAccountAuthority,
      ...TRemainingAccounts,
    ]
  >;

export type WithdrawExcessLamportsInstructionData = { discriminator: number };

export type WithdrawExcessLamportsInstructionDataArgs = {};

export function getWithdrawExcessLamportsInstructionDataEncoder(): Encoder<WithdrawExcessLamportsInstructionDataArgs> {
  return transformEncoder(
    getStructEncoder([['discriminator', getU8Encoder()]]),
    (value) => ({
      ...value,
      discriminator: WITHDRAW_EXCESS_LAMPORTS_DISCRIMINATOR,
    })
  );
}

export function getWithdrawExcessLamportsInstructionDataDecoder(): Decoder<WithdrawExcessLamportsInstructionData> {
  return getStructDecoder([['discriminator', getU8Decoder()]]);
}

export function getWithdrawExcessLamportsInstructionDataCodec(): Codec<
  WithdrawExcessLamportsInstructionDataArgs,
  WithdrawExcessLamportsInstructionData
> {
  return combineCodec(
    getWithdrawExcessLamportsInstructionDataEncoder(),
    getWithdrawExcessLamportsInstructionDataDecoder()
  );
}

export type WithdrawExcessLamportsInput<
  TAccountSourceAccount extends string = string,
  TAccountDestinationAccount extends string = string,
  TAccountAuthority extends string = string,
> = {
  /** Account holding excess lamports. */
  sourceAccount: Address<TAccountSourceAccount>;
  /** Destination account for withdrawn lamports. */
  destinationAccount: Address<TAccountDestinationAccount>;
  /** The source account's owner/delegate or its multisignature account. */
  authority: Address<TAccountAuthority> | TransactionSigner<TAccountAuthority>;
  multiSigners?: Array<TransactionSigner>;
};

export function getWithdrawExcessLamportsInstruction<
  TAccountSourceAccount extends string,
  TAccountDestinationAccount extends string,
  TAccountAuthority extends string,
  TProgramAddress extends Address = typeof TOKEN_2022_PROGRAM_ADDRESS,
>(
  input: WithdrawExcessLamportsInput<
    TAccountSourceAccount,
    TAccountDestinationAccount,
    TAccountAuthority
  >,
  config?: { programAddress?: TProgramAddress }
): WithdrawExcessLamportsInstruction<
  TProgramAddress,
  TAccountSourceAccount,
  TAccountDestinationAccount,
  (typeof input)['authority'] extends TransactionSigner<TAccountAuthority>
    ? ReadonlySignerAccount<TAccountAuthority> &
        IAccountSignerMeta<TAccountAuthority>
    : TAccountAuthority
> {
  // Program address.
  const programAddress = config?.programAddress ?? TOKEN_2022_PROGRAM_ADDRESS;

  // Original accounts.
  const originalAccounts = {
    sourceAccount: { value: input.sourceAccount ?? null, isWritable: true },
    destinationAccount: {
      value: input.destinationAccount ?? null,
      isWritable: true,
    },
    authority: { value: input.authority ?? null, isWritable: false },
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
      getAccountMeta(accounts.sourceAccount),
      getAccountMeta(accounts.destinationAccount),
      getAccountMeta(accounts.authority),
      ...remainingAccounts,
    ],
    programAddress,
    data: getWithdrawExcessLamportsInstructionDataEncoder().encode({}),
  } as WithdrawExcessLamportsInstruction<
    TProgramAddress,
    TAccountSourceAccount,
    TAccountDestinationAccount,
    (typeof input)['authority'] extends TransactionSigner<TAccountAuthority>
      ? ReadonlySignerAccount<TAccountAuthority> &
          IAccountSignerMeta<TAccountAuthority>
      : TAccountAuthority
  >;

  return instruction;
}

export type ParsedWithdrawExcessLamportsInstruction<
  TProgram extends string = typeof TOKEN_2022_PROGRAM_ADDRESS,
  TAccountMetas extends readonly IAccountMeta[] = readonly IAccountMeta[],
> = {
  programAddress: Address<TProgram>;
  accounts: {
    /** Account holding excess lamports. */
    sourceAccount: TAccountMetas[0];
    /** Destination account for withdrawn lamports. */
    destinationAccount: TAccountMetas[1];
    /** The source account's owner/delegate or its multisignature account. */
    authority: TAccountMetas[2];
  };
  data: WithdrawExcessLamportsInstructionData;
};

export function parseWithdrawExcessLamportsInstruction<
  TProgram extends string,
  TAccountMetas extends readonly IAccountMeta[],
>(
  instruction: IInstruction<TProgram> &
    IInstructionWithAccounts<TAccountMetas> &
    IInstructionWithData<Uint8Array>
): ParsedWithdrawExcessLamportsInstruction<TProgram, TAccountMetas> {
  if (instruction.accounts.length < 3) {
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
      sourceAccount: getNextAccount(),
      destinationAccount: getNextAccount(),
      authority: getNextAccount(),
    },
    data: getWithdrawExcessLamportsInstructionDataDecoder().decode(
      instruction.data
    ),
  };
}
