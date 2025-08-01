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
  getU64Decoder,
  getU64Encoder,
  getU8Decoder,
  getU8Encoder,
  transformEncoder,
  type AccountMeta,
  type AccountSignerMeta,
  type Address,
  type FixedSizeCodec,
  type FixedSizeDecoder,
  type FixedSizeEncoder,
  type Instruction,
  type InstructionWithAccounts,
  type InstructionWithData,
  type ReadonlyAccount,
  type ReadonlySignerAccount,
  type ReadonlyUint8Array,
  type TransactionSigner,
  type WritableAccount,
} from '@solana/kit';
import { TOKEN_2022_PROGRAM_ADDRESS } from '../programs';
import { getAccountMetaFactory, type ResolvedAccount } from '../shared';

export const CONFIDENTIAL_DEPOSIT_DISCRIMINATOR = 27;

export function getConfidentialDepositDiscriminatorBytes() {
  return getU8Encoder().encode(CONFIDENTIAL_DEPOSIT_DISCRIMINATOR);
}

export const CONFIDENTIAL_DEPOSIT_CONFIDENTIAL_TRANSFER_DISCRIMINATOR = 5;

export function getConfidentialDepositConfidentialTransferDiscriminatorBytes() {
  return getU8Encoder().encode(
    CONFIDENTIAL_DEPOSIT_CONFIDENTIAL_TRANSFER_DISCRIMINATOR
  );
}

export type ConfidentialDepositInstruction<
  TProgram extends string = typeof TOKEN_2022_PROGRAM_ADDRESS,
  TAccountToken extends string | AccountMeta<string> = string,
  TAccountMint extends string | AccountMeta<string> = string,
  TAccountAuthority extends string | AccountMeta<string> = string,
  TRemainingAccounts extends readonly AccountMeta<string>[] = [],
> = Instruction<TProgram> &
  InstructionWithData<ReadonlyUint8Array> &
  InstructionWithAccounts<
    [
      TAccountToken extends string
        ? WritableAccount<TAccountToken>
        : TAccountToken,
      TAccountMint extends string
        ? ReadonlyAccount<TAccountMint>
        : TAccountMint,
      TAccountAuthority extends string
        ? ReadonlyAccount<TAccountAuthority>
        : TAccountAuthority,
      ...TRemainingAccounts,
    ]
  >;

export type ConfidentialDepositInstructionData = {
  discriminator: number;
  confidentialTransferDiscriminator: number;
  /** The amount of tokens to deposit. */
  amount: bigint;
  /** Expected number of base 10 digits to the right of the decimal place. */
  decimals: number;
};

export type ConfidentialDepositInstructionDataArgs = {
  /** The amount of tokens to deposit. */
  amount: number | bigint;
  /** Expected number of base 10 digits to the right of the decimal place. */
  decimals: number;
};

export function getConfidentialDepositInstructionDataEncoder(): FixedSizeEncoder<ConfidentialDepositInstructionDataArgs> {
  return transformEncoder(
    getStructEncoder([
      ['discriminator', getU8Encoder()],
      ['confidentialTransferDiscriminator', getU8Encoder()],
      ['amount', getU64Encoder()],
      ['decimals', getU8Encoder()],
    ]),
    (value) => ({
      ...value,
      discriminator: CONFIDENTIAL_DEPOSIT_DISCRIMINATOR,
      confidentialTransferDiscriminator:
        CONFIDENTIAL_DEPOSIT_CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
    })
  );
}

export function getConfidentialDepositInstructionDataDecoder(): FixedSizeDecoder<ConfidentialDepositInstructionData> {
  return getStructDecoder([
    ['discriminator', getU8Decoder()],
    ['confidentialTransferDiscriminator', getU8Decoder()],
    ['amount', getU64Decoder()],
    ['decimals', getU8Decoder()],
  ]);
}

export function getConfidentialDepositInstructionDataCodec(): FixedSizeCodec<
  ConfidentialDepositInstructionDataArgs,
  ConfidentialDepositInstructionData
> {
  return combineCodec(
    getConfidentialDepositInstructionDataEncoder(),
    getConfidentialDepositInstructionDataDecoder()
  );
}

export type ConfidentialDepositInput<
  TAccountToken extends string = string,
  TAccountMint extends string = string,
  TAccountAuthority extends string = string,
> = {
  /** The SPL Token account. */
  token: Address<TAccountToken>;
  /** The corresponding SPL Token mint. */
  mint: Address<TAccountMint>;
  /** The source account's owner/delegate or its multisignature account. */
  authority: Address<TAccountAuthority> | TransactionSigner<TAccountAuthority>;
  amount: ConfidentialDepositInstructionDataArgs['amount'];
  decimals: ConfidentialDepositInstructionDataArgs['decimals'];
  multiSigners?: Array<TransactionSigner>;
};

export function getConfidentialDepositInstruction<
  TAccountToken extends string,
  TAccountMint extends string,
  TAccountAuthority extends string,
  TProgramAddress extends Address = typeof TOKEN_2022_PROGRAM_ADDRESS,
>(
  input: ConfidentialDepositInput<
    TAccountToken,
    TAccountMint,
    TAccountAuthority
  >,
  config?: { programAddress?: TProgramAddress }
): ConfidentialDepositInstruction<
  TProgramAddress,
  TAccountToken,
  TAccountMint,
  (typeof input)['authority'] extends TransactionSigner<TAccountAuthority>
    ? ReadonlySignerAccount<TAccountAuthority> &
        AccountSignerMeta<TAccountAuthority>
    : TAccountAuthority
> {
  // Program address.
  const programAddress = config?.programAddress ?? TOKEN_2022_PROGRAM_ADDRESS;

  // Original accounts.
  const originalAccounts = {
    token: { value: input.token ?? null, isWritable: true },
    mint: { value: input.mint ?? null, isWritable: false },
    authority: { value: input.authority ?? null, isWritable: false },
  };
  const accounts = originalAccounts as Record<
    keyof typeof originalAccounts,
    ResolvedAccount
  >;

  // Original args.
  const args = { ...input };

  // Remaining accounts.
  const remainingAccounts: AccountMeta[] = (args.multiSigners ?? []).map(
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
      getAccountMeta(accounts.mint),
      getAccountMeta(accounts.authority),
      ...remainingAccounts,
    ],
    programAddress,
    data: getConfidentialDepositInstructionDataEncoder().encode(
      args as ConfidentialDepositInstructionDataArgs
    ),
  } as ConfidentialDepositInstruction<
    TProgramAddress,
    TAccountToken,
    TAccountMint,
    (typeof input)['authority'] extends TransactionSigner<TAccountAuthority>
      ? ReadonlySignerAccount<TAccountAuthority> &
          AccountSignerMeta<TAccountAuthority>
      : TAccountAuthority
  >;

  return instruction;
}

export type ParsedConfidentialDepositInstruction<
  TProgram extends string = typeof TOKEN_2022_PROGRAM_ADDRESS,
  TAccountMetas extends readonly AccountMeta[] = readonly AccountMeta[],
> = {
  programAddress: Address<TProgram>;
  accounts: {
    /** The SPL Token account. */
    token: TAccountMetas[0];
    /** The corresponding SPL Token mint. */
    mint: TAccountMetas[1];
    /** The source account's owner/delegate or its multisignature account. */
    authority: TAccountMetas[2];
  };
  data: ConfidentialDepositInstructionData;
};

export function parseConfidentialDepositInstruction<
  TProgram extends string,
  TAccountMetas extends readonly AccountMeta[],
>(
  instruction: Instruction<TProgram> &
    InstructionWithAccounts<TAccountMetas> &
    InstructionWithData<ReadonlyUint8Array>
): ParsedConfidentialDepositInstruction<TProgram, TAccountMetas> {
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
      token: getNextAccount(),
      mint: getNextAccount(),
      authority: getNextAccount(),
    },
    data: getConfidentialDepositInstructionDataDecoder().decode(
      instruction.data
    ),
  };
}
