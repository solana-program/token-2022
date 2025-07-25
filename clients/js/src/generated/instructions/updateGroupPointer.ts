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
  getAddressDecoder,
  getAddressEncoder,
  getOptionDecoder,
  getOptionEncoder,
  getStructDecoder,
  getStructEncoder,
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
  type Option,
  type OptionOrNullable,
  type ReadonlyAccount,
  type ReadonlySignerAccount,
  type ReadonlyUint8Array,
  type TransactionSigner,
  type WritableAccount,
} from '@solana/kit';
import { TOKEN_2022_PROGRAM_ADDRESS } from '../programs';
import { getAccountMetaFactory, type ResolvedAccount } from '../shared';

export const UPDATE_GROUP_POINTER_DISCRIMINATOR = 40;

export function getUpdateGroupPointerDiscriminatorBytes() {
  return getU8Encoder().encode(UPDATE_GROUP_POINTER_DISCRIMINATOR);
}

export const UPDATE_GROUP_POINTER_GROUP_POINTER_DISCRIMINATOR = 1;

export function getUpdateGroupPointerGroupPointerDiscriminatorBytes() {
  return getU8Encoder().encode(
    UPDATE_GROUP_POINTER_GROUP_POINTER_DISCRIMINATOR
  );
}

export type UpdateGroupPointerInstruction<
  TProgram extends string = typeof TOKEN_2022_PROGRAM_ADDRESS,
  TAccountMint extends string | AccountMeta<string> = string,
  TAccountGroupPointerAuthority extends string | AccountMeta<string> = string,
  TRemainingAccounts extends readonly AccountMeta<string>[] = [],
> = Instruction<TProgram> &
  InstructionWithData<ReadonlyUint8Array> &
  InstructionWithAccounts<
    [
      TAccountMint extends string
        ? WritableAccount<TAccountMint>
        : TAccountMint,
      TAccountGroupPointerAuthority extends string
        ? ReadonlyAccount<TAccountGroupPointerAuthority>
        : TAccountGroupPointerAuthority,
      ...TRemainingAccounts,
    ]
  >;

export type UpdateGroupPointerInstructionData = {
  discriminator: number;
  groupPointerDiscriminator: number;
  /** The new account address that holds the group configurations. */
  groupAddress: Option<Address>;
};

export type UpdateGroupPointerInstructionDataArgs = {
  /** The new account address that holds the group configurations. */
  groupAddress: OptionOrNullable<Address>;
};

export function getUpdateGroupPointerInstructionDataEncoder(): FixedSizeEncoder<UpdateGroupPointerInstructionDataArgs> {
  return transformEncoder(
    getStructEncoder([
      ['discriminator', getU8Encoder()],
      ['groupPointerDiscriminator', getU8Encoder()],
      [
        'groupAddress',
        getOptionEncoder(getAddressEncoder(), {
          prefix: null,
          noneValue: 'zeroes',
        }),
      ],
    ]),
    (value) => ({
      ...value,
      discriminator: UPDATE_GROUP_POINTER_DISCRIMINATOR,
      groupPointerDiscriminator:
        UPDATE_GROUP_POINTER_GROUP_POINTER_DISCRIMINATOR,
    })
  );
}

export function getUpdateGroupPointerInstructionDataDecoder(): FixedSizeDecoder<UpdateGroupPointerInstructionData> {
  return getStructDecoder([
    ['discriminator', getU8Decoder()],
    ['groupPointerDiscriminator', getU8Decoder()],
    [
      'groupAddress',
      getOptionDecoder(getAddressDecoder(), {
        prefix: null,
        noneValue: 'zeroes',
      }),
    ],
  ]);
}

export function getUpdateGroupPointerInstructionDataCodec(): FixedSizeCodec<
  UpdateGroupPointerInstructionDataArgs,
  UpdateGroupPointerInstructionData
> {
  return combineCodec(
    getUpdateGroupPointerInstructionDataEncoder(),
    getUpdateGroupPointerInstructionDataDecoder()
  );
}

export type UpdateGroupPointerInput<
  TAccountMint extends string = string,
  TAccountGroupPointerAuthority extends string = string,
> = {
  /** The mint to initialize. */
  mint: Address<TAccountMint>;
  /** The group pointer authority or its multisignature account. */
  groupPointerAuthority:
    | Address<TAccountGroupPointerAuthority>
    | TransactionSigner<TAccountGroupPointerAuthority>;
  groupAddress: UpdateGroupPointerInstructionDataArgs['groupAddress'];
  multiSigners?: Array<TransactionSigner>;
};

export function getUpdateGroupPointerInstruction<
  TAccountMint extends string,
  TAccountGroupPointerAuthority extends string,
  TProgramAddress extends Address = typeof TOKEN_2022_PROGRAM_ADDRESS,
>(
  input: UpdateGroupPointerInput<TAccountMint, TAccountGroupPointerAuthority>,
  config?: { programAddress?: TProgramAddress }
): UpdateGroupPointerInstruction<
  TProgramAddress,
  TAccountMint,
  (typeof input)['groupPointerAuthority'] extends TransactionSigner<TAccountGroupPointerAuthority>
    ? ReadonlySignerAccount<TAccountGroupPointerAuthority> &
        AccountSignerMeta<TAccountGroupPointerAuthority>
    : TAccountGroupPointerAuthority
> {
  // Program address.
  const programAddress = config?.programAddress ?? TOKEN_2022_PROGRAM_ADDRESS;

  // Original accounts.
  const originalAccounts = {
    mint: { value: input.mint ?? null, isWritable: true },
    groupPointerAuthority: {
      value: input.groupPointerAuthority ?? null,
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
      getAccountMeta(accounts.mint),
      getAccountMeta(accounts.groupPointerAuthority),
      ...remainingAccounts,
    ],
    programAddress,
    data: getUpdateGroupPointerInstructionDataEncoder().encode(
      args as UpdateGroupPointerInstructionDataArgs
    ),
  } as UpdateGroupPointerInstruction<
    TProgramAddress,
    TAccountMint,
    (typeof input)['groupPointerAuthority'] extends TransactionSigner<TAccountGroupPointerAuthority>
      ? ReadonlySignerAccount<TAccountGroupPointerAuthority> &
          AccountSignerMeta<TAccountGroupPointerAuthority>
      : TAccountGroupPointerAuthority
  >;

  return instruction;
}

export type ParsedUpdateGroupPointerInstruction<
  TProgram extends string = typeof TOKEN_2022_PROGRAM_ADDRESS,
  TAccountMetas extends readonly AccountMeta[] = readonly AccountMeta[],
> = {
  programAddress: Address<TProgram>;
  accounts: {
    /** The mint to initialize. */
    mint: TAccountMetas[0];
    /** The group pointer authority or its multisignature account. */
    groupPointerAuthority: TAccountMetas[1];
  };
  data: UpdateGroupPointerInstructionData;
};

export function parseUpdateGroupPointerInstruction<
  TProgram extends string,
  TAccountMetas extends readonly AccountMeta[],
>(
  instruction: Instruction<TProgram> &
    InstructionWithAccounts<TAccountMetas> &
    InstructionWithData<ReadonlyUint8Array>
): ParsedUpdateGroupPointerInstruction<TProgram, TAccountMetas> {
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
      mint: getNextAccount(),
      groupPointerAuthority: getNextAccount(),
    },
    data: getUpdateGroupPointerInstructionDataDecoder().decode(
      instruction.data
    ),
  };
}
