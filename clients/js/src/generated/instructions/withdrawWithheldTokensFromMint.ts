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

export const WITHDRAW_WITHHELD_TOKENS_FROM_MINT_DISCRIMINATOR = 26;

export function getWithdrawWithheldTokensFromMintDiscriminatorBytes() {
  return getU8Encoder().encode(
    WITHDRAW_WITHHELD_TOKENS_FROM_MINT_DISCRIMINATOR
  );
}

export const WITHDRAW_WITHHELD_TOKENS_FROM_MINT_TRANSFER_FEE_DISCRIMINATOR = 2;

export function getWithdrawWithheldTokensFromMintTransferFeeDiscriminatorBytes() {
  return getU8Encoder().encode(
    WITHDRAW_WITHHELD_TOKENS_FROM_MINT_TRANSFER_FEE_DISCRIMINATOR
  );
}

export type WithdrawWithheldTokensFromMintInstruction<
  TProgram extends string = typeof TOKEN_2022_PROGRAM_ADDRESS,
  TAccountMint extends string | IAccountMeta<string> = string,
  TAccountFeeReceiver extends string | IAccountMeta<string> = string,
  TAccountWithdrawWithheldAuthority extends
    | string
    | IAccountMeta<string> = string,
  TRemainingAccounts extends readonly IAccountMeta<string>[] = [],
> = IInstruction<TProgram> &
  IInstructionWithData<Uint8Array> &
  IInstructionWithAccounts<
    [
      TAccountMint extends string
        ? WritableAccount<TAccountMint>
        : TAccountMint,
      TAccountFeeReceiver extends string
        ? WritableAccount<TAccountFeeReceiver>
        : TAccountFeeReceiver,
      TAccountWithdrawWithheldAuthority extends string
        ? ReadonlyAccount<TAccountWithdrawWithheldAuthority>
        : TAccountWithdrawWithheldAuthority,
      ...TRemainingAccounts,
    ]
  >;

export type WithdrawWithheldTokensFromMintInstructionData = {
  discriminator: number;
  transferFeeDiscriminator: number;
};

export type WithdrawWithheldTokensFromMintInstructionDataArgs = {};

export function getWithdrawWithheldTokensFromMintInstructionDataEncoder(): Encoder<WithdrawWithheldTokensFromMintInstructionDataArgs> {
  return transformEncoder(
    getStructEncoder([
      ['discriminator', getU8Encoder()],
      ['transferFeeDiscriminator', getU8Encoder()],
    ]),
    (value) => ({
      ...value,
      discriminator: WITHDRAW_WITHHELD_TOKENS_FROM_MINT_DISCRIMINATOR,
      transferFeeDiscriminator:
        WITHDRAW_WITHHELD_TOKENS_FROM_MINT_TRANSFER_FEE_DISCRIMINATOR,
    })
  );
}

export function getWithdrawWithheldTokensFromMintInstructionDataDecoder(): Decoder<WithdrawWithheldTokensFromMintInstructionData> {
  return getStructDecoder([
    ['discriminator', getU8Decoder()],
    ['transferFeeDiscriminator', getU8Decoder()],
  ]);
}

export function getWithdrawWithheldTokensFromMintInstructionDataCodec(): Codec<
  WithdrawWithheldTokensFromMintInstructionDataArgs,
  WithdrawWithheldTokensFromMintInstructionData
> {
  return combineCodec(
    getWithdrawWithheldTokensFromMintInstructionDataEncoder(),
    getWithdrawWithheldTokensFromMintInstructionDataDecoder()
  );
}

export type WithdrawWithheldTokensFromMintInput<
  TAccountMint extends string = string,
  TAccountFeeReceiver extends string = string,
  TAccountWithdrawWithheldAuthority extends string = string,
> = {
  /** The token mint. Must include the `TransferFeeConfig` extension. */
  mint: Address<TAccountMint>;
  /**
   * The fee receiver account. Must include the `TransferFeeAmount`
   * extension associated with the provided mint.
   */
  feeReceiver: Address<TAccountFeeReceiver>;
  /** The mint's `withdraw_withheld_authority` or its multisignature account. */
  withdrawWithheldAuthority:
    | Address<TAccountWithdrawWithheldAuthority>
    | TransactionSigner<TAccountWithdrawWithheldAuthority>;
  multiSigners?: Array<TransactionSigner>;
};

export function getWithdrawWithheldTokensFromMintInstruction<
  TAccountMint extends string,
  TAccountFeeReceiver extends string,
  TAccountWithdrawWithheldAuthority extends string,
  TProgramAddress extends Address = typeof TOKEN_2022_PROGRAM_ADDRESS,
>(
  input: WithdrawWithheldTokensFromMintInput<
    TAccountMint,
    TAccountFeeReceiver,
    TAccountWithdrawWithheldAuthority
  >,
  config?: { programAddress?: TProgramAddress }
): WithdrawWithheldTokensFromMintInstruction<
  TProgramAddress,
  TAccountMint,
  TAccountFeeReceiver,
  (typeof input)['withdrawWithheldAuthority'] extends TransactionSigner<TAccountWithdrawWithheldAuthority>
    ? ReadonlySignerAccount<TAccountWithdrawWithheldAuthority> &
        IAccountSignerMeta<TAccountWithdrawWithheldAuthority>
    : TAccountWithdrawWithheldAuthority
> {
  // Program address.
  const programAddress = config?.programAddress ?? TOKEN_2022_PROGRAM_ADDRESS;

  // Original accounts.
  const originalAccounts = {
    mint: { value: input.mint ?? null, isWritable: true },
    feeReceiver: { value: input.feeReceiver ?? null, isWritable: true },
    withdrawWithheldAuthority: {
      value: input.withdrawWithheldAuthority ?? null,
      isWritable: false,
    },
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
      getAccountMeta(accounts.mint),
      getAccountMeta(accounts.feeReceiver),
      getAccountMeta(accounts.withdrawWithheldAuthority),
      ...remainingAccounts,
    ],
    programAddress,
    data: getWithdrawWithheldTokensFromMintInstructionDataEncoder().encode({}),
  } as WithdrawWithheldTokensFromMintInstruction<
    TProgramAddress,
    TAccountMint,
    TAccountFeeReceiver,
    (typeof input)['withdrawWithheldAuthority'] extends TransactionSigner<TAccountWithdrawWithheldAuthority>
      ? ReadonlySignerAccount<TAccountWithdrawWithheldAuthority> &
          IAccountSignerMeta<TAccountWithdrawWithheldAuthority>
      : TAccountWithdrawWithheldAuthority
  >;

  return instruction;
}

export type ParsedWithdrawWithheldTokensFromMintInstruction<
  TProgram extends string = typeof TOKEN_2022_PROGRAM_ADDRESS,
  TAccountMetas extends readonly IAccountMeta[] = readonly IAccountMeta[],
> = {
  programAddress: Address<TProgram>;
  accounts: {
    /** The token mint. Must include the `TransferFeeConfig` extension. */
    mint: TAccountMetas[0];
    /**
     * The fee receiver account. Must include the `TransferFeeAmount`
     * extension associated with the provided mint.
     */

    feeReceiver: TAccountMetas[1];
    /** The mint's `withdraw_withheld_authority` or its multisignature account. */
    withdrawWithheldAuthority: TAccountMetas[2];
  };
  data: WithdrawWithheldTokensFromMintInstructionData;
};

export function parseWithdrawWithheldTokensFromMintInstruction<
  TProgram extends string,
  TAccountMetas extends readonly IAccountMeta[],
>(
  instruction: IInstruction<TProgram> &
    IInstructionWithAccounts<TAccountMetas> &
    IInstructionWithData<Uint8Array>
): ParsedWithdrawWithheldTokensFromMintInstruction<TProgram, TAccountMetas> {
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
      mint: getNextAccount(),
      feeReceiver: getNextAccount(),
      withdrawWithheldAuthority: getNextAccount(),
    },
    data: getWithdrawWithheldTokensFromMintInstructionDataDecoder().decode(
      instruction.data
    ),
  };
}
