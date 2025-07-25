/**
 * This code was AUTOGENERATED using the codama library.
 * Please DO NOT EDIT THIS FILE, instead use visitors
 * to add features, then rerun codama to update it.
 *
 * @see https://github.com/codama-idl/codama
 */

import {
  combineCodec,
  getBytesDecoder,
  getBytesEncoder,
  getStructDecoder,
  getStructEncoder,
  transformEncoder,
  type AccountMeta,
  type AccountSignerMeta,
  type Address,
  type Codec,
  type Decoder,
  type Encoder,
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

export const INITIALIZE_TOKEN_GROUP_MEMBER_DISCRIMINATOR = new Uint8Array([
  152, 32, 222, 176, 223, 237, 116, 134,
]);

export function getInitializeTokenGroupMemberDiscriminatorBytes() {
  return getBytesEncoder().encode(INITIALIZE_TOKEN_GROUP_MEMBER_DISCRIMINATOR);
}

export type InitializeTokenGroupMemberInstruction<
  TProgram extends string = typeof TOKEN_2022_PROGRAM_ADDRESS,
  TAccountMember extends string | AccountMeta<string> = string,
  TAccountMemberMint extends string | AccountMeta<string> = string,
  TAccountMemberMintAuthority extends string | AccountMeta<string> = string,
  TAccountGroup extends string | AccountMeta<string> = string,
  TAccountGroupUpdateAuthority extends string | AccountMeta<string> = string,
  TRemainingAccounts extends readonly AccountMeta<string>[] = [],
> = Instruction<TProgram> &
  InstructionWithData<ReadonlyUint8Array> &
  InstructionWithAccounts<
    [
      TAccountMember extends string
        ? WritableAccount<TAccountMember>
        : TAccountMember,
      TAccountMemberMint extends string
        ? ReadonlyAccount<TAccountMemberMint>
        : TAccountMemberMint,
      TAccountMemberMintAuthority extends string
        ? ReadonlySignerAccount<TAccountMemberMintAuthority> &
            AccountSignerMeta<TAccountMemberMintAuthority>
        : TAccountMemberMintAuthority,
      TAccountGroup extends string
        ? WritableAccount<TAccountGroup>
        : TAccountGroup,
      TAccountGroupUpdateAuthority extends string
        ? ReadonlySignerAccount<TAccountGroupUpdateAuthority> &
            AccountSignerMeta<TAccountGroupUpdateAuthority>
        : TAccountGroupUpdateAuthority,
      ...TRemainingAccounts,
    ]
  >;

export type InitializeTokenGroupMemberInstructionData = {
  discriminator: ReadonlyUint8Array;
};

export type InitializeTokenGroupMemberInstructionDataArgs = {};

export function getInitializeTokenGroupMemberInstructionDataEncoder(): Encoder<InitializeTokenGroupMemberInstructionDataArgs> {
  return transformEncoder(
    getStructEncoder([['discriminator', getBytesEncoder()]]),
    (value) => ({
      ...value,
      discriminator: INITIALIZE_TOKEN_GROUP_MEMBER_DISCRIMINATOR,
    })
  );
}

export function getInitializeTokenGroupMemberInstructionDataDecoder(): Decoder<InitializeTokenGroupMemberInstructionData> {
  return getStructDecoder([['discriminator', getBytesDecoder()]]);
}

export function getInitializeTokenGroupMemberInstructionDataCodec(): Codec<
  InitializeTokenGroupMemberInstructionDataArgs,
  InitializeTokenGroupMemberInstructionData
> {
  return combineCodec(
    getInitializeTokenGroupMemberInstructionDataEncoder(),
    getInitializeTokenGroupMemberInstructionDataDecoder()
  );
}

export type InitializeTokenGroupMemberInput<
  TAccountMember extends string = string,
  TAccountMemberMint extends string = string,
  TAccountMemberMintAuthority extends string = string,
  TAccountGroup extends string = string,
  TAccountGroupUpdateAuthority extends string = string,
> = {
  member: Address<TAccountMember>;
  memberMint: Address<TAccountMemberMint>;
  memberMintAuthority: TransactionSigner<TAccountMemberMintAuthority>;
  group: Address<TAccountGroup>;
  groupUpdateAuthority: TransactionSigner<TAccountGroupUpdateAuthority>;
};

export function getInitializeTokenGroupMemberInstruction<
  TAccountMember extends string,
  TAccountMemberMint extends string,
  TAccountMemberMintAuthority extends string,
  TAccountGroup extends string,
  TAccountGroupUpdateAuthority extends string,
  TProgramAddress extends Address = typeof TOKEN_2022_PROGRAM_ADDRESS,
>(
  input: InitializeTokenGroupMemberInput<
    TAccountMember,
    TAccountMemberMint,
    TAccountMemberMintAuthority,
    TAccountGroup,
    TAccountGroupUpdateAuthority
  >,
  config?: { programAddress?: TProgramAddress }
): InitializeTokenGroupMemberInstruction<
  TProgramAddress,
  TAccountMember,
  TAccountMemberMint,
  TAccountMemberMintAuthority,
  TAccountGroup,
  TAccountGroupUpdateAuthority
> {
  // Program address.
  const programAddress = config?.programAddress ?? TOKEN_2022_PROGRAM_ADDRESS;

  // Original accounts.
  const originalAccounts = {
    member: { value: input.member ?? null, isWritable: true },
    memberMint: { value: input.memberMint ?? null, isWritable: false },
    memberMintAuthority: {
      value: input.memberMintAuthority ?? null,
      isWritable: false,
    },
    group: { value: input.group ?? null, isWritable: true },
    groupUpdateAuthority: {
      value: input.groupUpdateAuthority ?? null,
      isWritable: false,
    },
  };
  const accounts = originalAccounts as Record<
    keyof typeof originalAccounts,
    ResolvedAccount
  >;

  const getAccountMeta = getAccountMetaFactory(programAddress, 'programId');
  const instruction = {
    accounts: [
      getAccountMeta(accounts.member),
      getAccountMeta(accounts.memberMint),
      getAccountMeta(accounts.memberMintAuthority),
      getAccountMeta(accounts.group),
      getAccountMeta(accounts.groupUpdateAuthority),
    ],
    programAddress,
    data: getInitializeTokenGroupMemberInstructionDataEncoder().encode({}),
  } as InitializeTokenGroupMemberInstruction<
    TProgramAddress,
    TAccountMember,
    TAccountMemberMint,
    TAccountMemberMintAuthority,
    TAccountGroup,
    TAccountGroupUpdateAuthority
  >;

  return instruction;
}

export type ParsedInitializeTokenGroupMemberInstruction<
  TProgram extends string = typeof TOKEN_2022_PROGRAM_ADDRESS,
  TAccountMetas extends readonly AccountMeta[] = readonly AccountMeta[],
> = {
  programAddress: Address<TProgram>;
  accounts: {
    member: TAccountMetas[0];
    memberMint: TAccountMetas[1];
    memberMintAuthority: TAccountMetas[2];
    group: TAccountMetas[3];
    groupUpdateAuthority: TAccountMetas[4];
  };
  data: InitializeTokenGroupMemberInstructionData;
};

export function parseInitializeTokenGroupMemberInstruction<
  TProgram extends string,
  TAccountMetas extends readonly AccountMeta[],
>(
  instruction: Instruction<TProgram> &
    InstructionWithAccounts<TAccountMetas> &
    InstructionWithData<ReadonlyUint8Array>
): ParsedInitializeTokenGroupMemberInstruction<TProgram, TAccountMetas> {
  if (instruction.accounts.length < 5) {
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
      member: getNextAccount(),
      memberMint: getNextAccount(),
      memberMintAuthority: getNextAccount(),
      group: getNextAccount(),
      groupUpdateAuthority: getNextAccount(),
    },
    data: getInitializeTokenGroupMemberInstructionDataDecoder().decode(
      instruction.data
    ),
  };
}
