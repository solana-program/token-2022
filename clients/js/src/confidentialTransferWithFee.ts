/**
 * Handwritten confidential-transfer instruction override.
 *
 * The generated client cannot express this instruction's data-dependent
 * account layout correctly, so the public package surface exports this
 * implementation instead of the generated one.
 */

import {
    AccountRole,
    combineCodec,
    getI8Decoder,
    getI8Encoder,
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
    type ReadonlyAccount,
    type ReadonlySignerAccount,
    type ReadonlyUint8Array,
    type TransactionSigner,
    type WritableAccount,
} from '@solana/kit';
import { TOKEN_2022_PROGRAM_ADDRESS } from './generated/programs';
import { getAccountMetaFactory, type ResolvedAccount } from './generated/shared';
import {
    getDecryptableBalanceDecoder,
    getDecryptableBalanceEncoder,
    type DecryptableBalance,
    type DecryptableBalanceArgs,
} from './generated/types';

export const CONFIDENTIAL_TRANSFER_WITH_FEE_DISCRIMINATOR = 27;

export function getConfidentialTransferWithFeeDiscriminatorBytes() {
    return getU8Encoder().encode(CONFIDENTIAL_TRANSFER_WITH_FEE_DISCRIMINATOR);
}

export const CONFIDENTIAL_TRANSFER_WITH_FEE_CONFIDENTIAL_TRANSFER_DISCRIMINATOR = 13;

export function getConfidentialTransferWithFeeConfidentialTransferDiscriminatorBytes() {
    return getU8Encoder().encode(CONFIDENTIAL_TRANSFER_WITH_FEE_CONFIDENTIAL_TRANSFER_DISCRIMINATOR);
}

export type ConfidentialTransferWithFeeInstruction<
    TProgram extends string = typeof TOKEN_2022_PROGRAM_ADDRESS,
    TAccountSourceToken extends string | AccountMeta<string> = string,
    TAccountMint extends string | AccountMeta<string> = string,
    TAccountDestinationToken extends string | AccountMeta<string> = string,
    TAccountInstructionsSysvar extends string | AccountMeta<string> = string,
    TAccountEqualityRecord extends string | AccountMeta<string> = string,
    TAccountTransferAmountCiphertextValidityRecord extends string | AccountMeta<string> = string,
    TAccountFeeSigmaRecord extends string | AccountMeta<string> = string,
    TAccountFeeCiphertextValidityRecord extends string | AccountMeta<string> = string,
    TAccountRangeRecord extends string | AccountMeta<string> = string,
    TAccountAuthority extends string | AccountMeta<string> = string,
    TRemainingAccounts extends readonly AccountMeta<string>[] = [],
> = Instruction<TProgram> &
    InstructionWithData<ReadonlyUint8Array> &
    InstructionWithAccounts<
        [
            TAccountSourceToken extends string ? WritableAccount<TAccountSourceToken> : TAccountSourceToken,
            TAccountMint extends string ? ReadonlyAccount<TAccountMint> : TAccountMint,
            TAccountDestinationToken extends string
                ? WritableAccount<TAccountDestinationToken>
                : TAccountDestinationToken,
            TAccountInstructionsSysvar extends string
                ? ReadonlyAccount<TAccountInstructionsSysvar>
                : TAccountInstructionsSysvar,
            TAccountEqualityRecord extends string ? ReadonlyAccount<TAccountEqualityRecord> : TAccountEqualityRecord,
            TAccountTransferAmountCiphertextValidityRecord extends string
                ? ReadonlyAccount<TAccountTransferAmountCiphertextValidityRecord>
                : TAccountTransferAmountCiphertextValidityRecord,
            TAccountFeeSigmaRecord extends string ? ReadonlyAccount<TAccountFeeSigmaRecord> : TAccountFeeSigmaRecord,
            TAccountFeeCiphertextValidityRecord extends string
                ? ReadonlyAccount<TAccountFeeCiphertextValidityRecord>
                : TAccountFeeCiphertextValidityRecord,
            TAccountRangeRecord extends string ? ReadonlyAccount<TAccountRangeRecord> : TAccountRangeRecord,
            TAccountAuthority extends string ? ReadonlyAccount<TAccountAuthority> : TAccountAuthority,
            ...TRemainingAccounts,
        ]
    >;

export type ConfidentialTransferWithFeeInstructionData = {
    discriminator: number;
    confidentialTransferDiscriminator: number;
    /** The new source decryptable balance if the transfer succeeds. */
    newSourceDecryptableAvailableBalance: DecryptableBalance;
    /**
     * Relative location of the
     * `ProofInstruction::VerifyCiphertextCommitmentEquality` instruction
     * to the `TransferWithFee` instruction in the transaction. If the offset
     * is `0`, then use a context state account for the proof.
     */
    equalityProofInstructionOffset: number;
    /**
     * Relative location of the
     * `ProofInstruction::VerifyBatchedGroupedCiphertext3HandlesValidity`
     * instruction to the `TransferWithFee` instruction in the transaction.
     * If the offset is `0`, then use a context state account for the
     * proof.
     */
    transferAmountCiphertextValidityProofInstructionOffset: number;
    /**
     * Relative location of the `ProofInstruction::VerifyPercentageWithFee`
     * instruction to the `TransferWithFee` instruction in the transaction.
     * If the offset is `0`, then use a context state account for the
     * proof.
     */
    feeSigmaProofInstructionOffset: number;
    /**
     * Relative location of the
     * `ProofInstruction::VerifyBatchedGroupedCiphertext2HandlesValidity`
     * instruction to the `TransferWithFee` instruction in the transaction.
     * If the offset is `0`, then use a context state account for the
     * proof.
     */
    feeCiphertextValidityProofInstructionOffset: number;
    /**
     * Relative location of the `ProofInstruction::BatchedRangeProofU256Data`
     * instruction to the `TransferWithFee` instruction in the transaction.
     * If the offset is `0`, then use a context state account for the
     * proof.
     */
    rangeProofInstructionOffset: number;
};

export type ConfidentialTransferWithFeeInstructionDataArgs = {
    /** The new source decryptable balance if the transfer succeeds. */
    newSourceDecryptableAvailableBalance: DecryptableBalanceArgs;
    /**
     * Relative location of the
     * `ProofInstruction::VerifyCiphertextCommitmentEquality` instruction
     * to the `TransferWithFee` instruction in the transaction. If the offset
     * is `0`, then use a context state account for the proof.
     */
    equalityProofInstructionOffset: number;
    /**
     * Relative location of the
     * `ProofInstruction::VerifyBatchedGroupedCiphertext3HandlesValidity`
     * instruction to the `TransferWithFee` instruction in the transaction.
     * If the offset is `0`, then use a context state account for the
     * proof.
     */
    transferAmountCiphertextValidityProofInstructionOffset: number;
    /**
     * Relative location of the `ProofInstruction::VerifyPercentageWithFee`
     * instruction to the `TransferWithFee` instruction in the transaction.
     * If the offset is `0`, then use a context state account for the
     * proof.
     */
    feeSigmaProofInstructionOffset: number;
    /**
     * Relative location of the
     * `ProofInstruction::VerifyBatchedGroupedCiphertext2HandlesValidity`
     * instruction to the `TransferWithFee` instruction in the transaction.
     * If the offset is `0`, then use a context state account for the
     * proof.
     */
    feeCiphertextValidityProofInstructionOffset: number;
    /**
     * Relative location of the `ProofInstruction::BatchedRangeProofU256Data`
     * instruction to the `TransferWithFee` instruction in the transaction.
     * If the offset is `0`, then use a context state account for the
     * proof.
     */
    rangeProofInstructionOffset: number;
};

export function getConfidentialTransferWithFeeInstructionDataEncoder(): FixedSizeEncoder<ConfidentialTransferWithFeeInstructionDataArgs> {
    return transformEncoder(
        getStructEncoder([
            ['discriminator', getU8Encoder()],
            ['confidentialTransferDiscriminator', getU8Encoder()],
            ['newSourceDecryptableAvailableBalance', getDecryptableBalanceEncoder()],
            ['equalityProofInstructionOffset', getI8Encoder()],
            ['transferAmountCiphertextValidityProofInstructionOffset', getI8Encoder()],
            ['feeSigmaProofInstructionOffset', getI8Encoder()],
            ['feeCiphertextValidityProofInstructionOffset', getI8Encoder()],
            ['rangeProofInstructionOffset', getI8Encoder()],
        ]),
        value => ({
            ...value,
            discriminator: CONFIDENTIAL_TRANSFER_WITH_FEE_DISCRIMINATOR,
            confidentialTransferDiscriminator: CONFIDENTIAL_TRANSFER_WITH_FEE_CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
        }),
    );
}

export function getConfidentialTransferWithFeeInstructionDataDecoder(): FixedSizeDecoder<ConfidentialTransferWithFeeInstructionData> {
    return getStructDecoder([
        ['discriminator', getU8Decoder()],
        ['confidentialTransferDiscriminator', getU8Decoder()],
        ['newSourceDecryptableAvailableBalance', getDecryptableBalanceDecoder()],
        ['equalityProofInstructionOffset', getI8Decoder()],
        ['transferAmountCiphertextValidityProofInstructionOffset', getI8Decoder()],
        ['feeSigmaProofInstructionOffset', getI8Decoder()],
        ['feeCiphertextValidityProofInstructionOffset', getI8Decoder()],
        ['rangeProofInstructionOffset', getI8Decoder()],
    ]);
}

export function getConfidentialTransferWithFeeInstructionDataCodec(): FixedSizeCodec<
    ConfidentialTransferWithFeeInstructionDataArgs,
    ConfidentialTransferWithFeeInstructionData
> {
    return combineCodec(
        getConfidentialTransferWithFeeInstructionDataEncoder(),
        getConfidentialTransferWithFeeInstructionDataDecoder(),
    );
}

export type ConfidentialTransferWithFeeInput<
    TAccountSourceToken extends string = string,
    TAccountMint extends string = string,
    TAccountDestinationToken extends string = string,
    TAccountInstructionsSysvar extends string = string,
    TAccountEqualityRecord extends string = string,
    TAccountTransferAmountCiphertextValidityRecord extends string = string,
    TAccountFeeSigmaRecord extends string = string,
    TAccountFeeCiphertextValidityRecord extends string = string,
    TAccountRangeRecord extends string = string,
    TAccountAuthority extends string = string,
> = {
    /** The source SPL Token account. */
    sourceToken: Address<TAccountSourceToken>;
    /** The corresponding SPL Token mint. */
    mint: Address<TAccountMint>;
    /** The destination SPL Token account. */
    destinationToken: Address<TAccountDestinationToken>;
    /**
     * (Optional) Instructions sysvar if at least one of the
     * `zk_elgamal_proof` instructions are included in the same
     * transaction.
     */
    instructionsSysvar?: Address<TAccountInstructionsSysvar>;
    /** (Optional) Equality proof record account or context state account. */
    equalityRecord?: Address<TAccountEqualityRecord>;
    /**
     * (Optional) Transfer amount ciphertext validity proof record
     * account or context state account.
     */
    transferAmountCiphertextValidityRecord?: Address<TAccountTransferAmountCiphertextValidityRecord>;
    /** (Optional) Fee sigma proof record account or context state account. */
    feeSigmaRecord?: Address<TAccountFeeSigmaRecord>;
    /** (Optional) Fee ciphertext validity proof record account or context state account. */
    feeCiphertextValidityRecord?: Address<TAccountFeeCiphertextValidityRecord>;
    /** (Optional) Range proof record account or context state account. */
    rangeRecord?: Address<TAccountRangeRecord>;
    /** The source account's owner/delegate or its multisignature account. */
    authority: Address<TAccountAuthority> | TransactionSigner<TAccountAuthority>;
    newSourceDecryptableAvailableBalance: ConfidentialTransferWithFeeInstructionDataArgs['newSourceDecryptableAvailableBalance'];
    equalityProofInstructionOffset: ConfidentialTransferWithFeeInstructionDataArgs['equalityProofInstructionOffset'];
    transferAmountCiphertextValidityProofInstructionOffset: ConfidentialTransferWithFeeInstructionDataArgs['transferAmountCiphertextValidityProofInstructionOffset'];
    feeSigmaProofInstructionOffset: ConfidentialTransferWithFeeInstructionDataArgs['feeSigmaProofInstructionOffset'];
    feeCiphertextValidityProofInstructionOffset: ConfidentialTransferWithFeeInstructionDataArgs['feeCiphertextValidityProofInstructionOffset'];
    rangeProofInstructionOffset: ConfidentialTransferWithFeeInstructionDataArgs['rangeProofInstructionOffset'];
    multiSigners?: Array<TransactionSigner>;
};

export function getConfidentialTransferWithFeeInstruction<
    TAccountSourceToken extends string,
    TAccountMint extends string,
    TAccountDestinationToken extends string,
    TAccountInstructionsSysvar extends string,
    TAccountEqualityRecord extends string,
    TAccountTransferAmountCiphertextValidityRecord extends string,
    TAccountFeeSigmaRecord extends string,
    TAccountFeeCiphertextValidityRecord extends string,
    TAccountRangeRecord extends string,
    TAccountAuthority extends string,
    TProgramAddress extends Address = typeof TOKEN_2022_PROGRAM_ADDRESS,
>(
    input: ConfidentialTransferWithFeeInput<
        TAccountSourceToken,
        TAccountMint,
        TAccountDestinationToken,
        TAccountInstructionsSysvar,
        TAccountEqualityRecord,
        TAccountTransferAmountCiphertextValidityRecord,
        TAccountFeeSigmaRecord,
        TAccountFeeCiphertextValidityRecord,
        TAccountRangeRecord,
        TAccountAuthority
    >,
    config?: { programAddress?: TProgramAddress },
): ConfidentialTransferWithFeeInstruction<
    TProgramAddress,
    TAccountSourceToken,
    TAccountMint,
    TAccountDestinationToken,
    TAccountInstructionsSysvar,
    TAccountEqualityRecord,
    TAccountTransferAmountCiphertextValidityRecord,
    TAccountFeeSigmaRecord,
    TAccountFeeCiphertextValidityRecord,
    TAccountRangeRecord,
    (typeof input)['authority'] extends TransactionSigner<TAccountAuthority>
        ? ReadonlySignerAccount<TAccountAuthority> & AccountSignerMeta<TAccountAuthority>
        : TAccountAuthority
> {
    // Program address.
    const programAddress = config?.programAddress ?? TOKEN_2022_PROGRAM_ADDRESS;

    // Original accounts.
    const originalAccounts = {
        sourceToken: { value: input.sourceToken ?? null, isWritable: true },
        mint: { value: input.mint ?? null, isWritable: false },
        destinationToken: { value: input.destinationToken ?? null, isWritable: true },
        instructionsSysvar: { value: input.instructionsSysvar ?? null, isWritable: false },
        equalityRecord: { value: input.equalityRecord ?? null, isWritable: false },
        transferAmountCiphertextValidityRecord: {
            value: input.transferAmountCiphertextValidityRecord ?? null,
            isWritable: false,
        },
        feeSigmaRecord: { value: input.feeSigmaRecord ?? null, isWritable: false },
        feeCiphertextValidityRecord: { value: input.feeCiphertextValidityRecord ?? null, isWritable: false },
        rangeRecord: { value: input.rangeRecord ?? null, isWritable: false },
        authority: { value: input.authority ?? null, isWritable: false },
    };
    const accounts = originalAccounts as Record<keyof typeof originalAccounts, ResolvedAccount>;

    // Original args.
    const args = { ...input };

    // Resolve default values and validate proof account combinations.
    const usesInstructionSysvar =
        args.equalityProofInstructionOffset !== 0 ||
        args.transferAmountCiphertextValidityProofInstructionOffset !== 0 ||
        args.feeSigmaProofInstructionOffset !== 0 ||
        args.feeCiphertextValidityProofInstructionOffset !== 0 ||
        args.rangeProofInstructionOffset !== 0;
    if (usesInstructionSysvar && !accounts.instructionsSysvar.value) {
        accounts.instructionsSysvar.value =
            'Sysvar1nstructions1111111111111111111111111' as Address<'Sysvar1nstructions1111111111111111111111111'>;
    }
    if (!usesInstructionSysvar && accounts.instructionsSysvar.value) {
        throw new Error('instructionsSysvar must be omitted when all proofs use context state accounts');
    }
    if (args.equalityProofInstructionOffset === 0) {
        if (!accounts.equalityRecord.value) {
            throw new Error('Expected equalityRecord when equalityProofInstructionOffset is 0');
        }
    } else {
        accounts.equalityRecord.value = null;
    }
    if (args.transferAmountCiphertextValidityProofInstructionOffset === 0) {
        if (!accounts.transferAmountCiphertextValidityRecord.value) {
            throw new Error(
                'Expected transferAmountCiphertextValidityRecord when transferAmountCiphertextValidityProofInstructionOffset is 0',
            );
        }
    } else {
        accounts.transferAmountCiphertextValidityRecord.value = null;
    }
    if (args.feeSigmaProofInstructionOffset === 0) {
        if (!accounts.feeSigmaRecord.value) {
            throw new Error('Expected feeSigmaRecord when feeSigmaProofInstructionOffset is 0');
        }
    } else {
        accounts.feeSigmaRecord.value = null;
    }
    if (args.feeCiphertextValidityProofInstructionOffset === 0) {
        if (!accounts.feeCiphertextValidityRecord.value) {
            throw new Error(
                'Expected feeCiphertextValidityRecord when feeCiphertextValidityProofInstructionOffset is 0',
            );
        }
    } else {
        accounts.feeCiphertextValidityRecord.value = null;
    }
    if (args.rangeProofInstructionOffset === 0) {
        if (!accounts.rangeRecord.value) {
            throw new Error('Expected rangeRecord when rangeProofInstructionOffset is 0');
        }
    } else {
        accounts.rangeRecord.value = null;
    }

    // Remaining accounts.
    const remainingAccounts: AccountMeta[] = (args.multiSigners ?? []).map(signer => ({
        address: signer.address,
        role: AccountRole.READONLY_SIGNER,
        signer,
    }));

    const getAccountMeta = getAccountMetaFactory(programAddress, 'omitted');
    return Object.freeze({
        accounts: [
            getAccountMeta(accounts.sourceToken),
            getAccountMeta(accounts.mint),
            getAccountMeta(accounts.destinationToken),
            getAccountMeta(accounts.instructionsSysvar),
            getAccountMeta(accounts.equalityRecord),
            getAccountMeta(accounts.transferAmountCiphertextValidityRecord),
            getAccountMeta(accounts.feeSigmaRecord),
            getAccountMeta(accounts.feeCiphertextValidityRecord),
            getAccountMeta(accounts.rangeRecord),
            getAccountMeta(accounts.authority),
            ...remainingAccounts,
        ].filter((accountMeta): accountMeta is AccountMeta | AccountSignerMeta => accountMeta !== undefined),
        data: getConfidentialTransferWithFeeInstructionDataEncoder().encode(
            args as ConfidentialTransferWithFeeInstructionDataArgs,
        ),
        programAddress,
    } as ConfidentialTransferWithFeeInstruction<
        TProgramAddress,
        TAccountSourceToken,
        TAccountMint,
        TAccountDestinationToken,
        TAccountInstructionsSysvar,
        TAccountEqualityRecord,
        TAccountTransferAmountCiphertextValidityRecord,
        TAccountFeeSigmaRecord,
        TAccountFeeCiphertextValidityRecord,
        TAccountRangeRecord,
        (typeof input)['authority'] extends TransactionSigner<TAccountAuthority>
            ? ReadonlySignerAccount<TAccountAuthority> & AccountSignerMeta<TAccountAuthority>
            : TAccountAuthority
    >);
}

export type ParsedConfidentialTransferWithFeeInstruction<
    TProgram extends string = typeof TOKEN_2022_PROGRAM_ADDRESS,
    TAccountMetas extends readonly AccountMeta[] = readonly AccountMeta[],
> = {
    programAddress: Address<TProgram>;
    accounts: {
        /** The source SPL Token account. */
        sourceToken: TAccountMetas[0];
        /** The corresponding SPL Token mint. */
        mint: TAccountMetas[1];
        /** The destination SPL Token account. */
        destinationToken: TAccountMetas[2];
        /**
         * (Optional) Instructions sysvar if at least one of the
         * `zk_elgamal_proof` instructions are included in the same
         * transaction.
         */
        instructionsSysvar?: TAccountMetas[3] | undefined;
        /** (Optional) Equality proof record account or context state account. */
        equalityRecord?: TAccountMetas[number] | undefined;
        /**
         * (Optional) Transfer amount ciphertext validity proof record
         * account or context state account.
         */
        transferAmountCiphertextValidityRecord?: TAccountMetas[number] | undefined;
        /** (Optional) Fee sigma proof record account or context state account. */
        feeSigmaRecord?: TAccountMetas[number] | undefined;
        /** (Optional) Fee ciphertext validity proof record account or context state account. */
        feeCiphertextValidityRecord?: TAccountMetas[number] | undefined;
        /** (Optional) Range proof record account or context state account. */
        rangeRecord?: TAccountMetas[number] | undefined;
        /** The source account's owner/delegate or its multisignature account. */
        authority: TAccountMetas[number];
    };
    data: ConfidentialTransferWithFeeInstructionData;
};

export function parseConfidentialTransferWithFeeInstruction<
    TProgram extends string,
    TAccountMetas extends readonly AccountMeta[],
>(
    instruction: Instruction<TProgram> &
        InstructionWithAccounts<TAccountMetas> &
        InstructionWithData<ReadonlyUint8Array>,
): ParsedConfidentialTransferWithFeeInstruction<TProgram, TAccountMetas> {
    const data = getConfidentialTransferWithFeeInstructionDataDecoder().decode(instruction.data);
    const hasInstructionsSysvar =
        data.equalityProofInstructionOffset !== 0 ||
        data.transferAmountCiphertextValidityProofInstructionOffset !== 0 ||
        data.feeSigmaProofInstructionOffset !== 0 ||
        data.feeCiphertextValidityProofInstructionOffset !== 0 ||
        data.rangeProofInstructionOffset !== 0;
    const minimumNumberOfAccounts =
        4 +
        (hasInstructionsSysvar ? 1 : 0) +
        (data.equalityProofInstructionOffset === 0 ? 1 : 0) +
        (data.transferAmountCiphertextValidityProofInstructionOffset === 0 ? 1 : 0) +
        (data.feeSigmaProofInstructionOffset === 0 ? 1 : 0) +
        (data.feeCiphertextValidityProofInstructionOffset === 0 ? 1 : 0) +
        (data.rangeProofInstructionOffset === 0 ? 1 : 0);
    if (instruction.accounts.length < minimumNumberOfAccounts) {
        // TODO: Coded error.
        throw new Error('Not enough accounts');
    }
    let accountIndex = 0;
    const getNextAccount = () => {
        const accountMeta = (instruction.accounts as TAccountMetas)[accountIndex]!;
        accountIndex += 1;
        return accountMeta;
    };
    return {
        programAddress: instruction.programAddress,
        accounts: {
            sourceToken: getNextAccount(),
            mint: getNextAccount(),
            destinationToken: getNextAccount(),
            instructionsSysvar: hasInstructionsSysvar ? getNextAccount() : undefined,
            equalityRecord: data.equalityProofInstructionOffset === 0 ? getNextAccount() : undefined,
            transferAmountCiphertextValidityRecord:
                data.transferAmountCiphertextValidityProofInstructionOffset === 0 ? getNextAccount() : undefined,
            feeSigmaRecord: data.feeSigmaProofInstructionOffset === 0 ? getNextAccount() : undefined,
            feeCiphertextValidityRecord:
                data.feeCiphertextValidityProofInstructionOffset === 0 ? getNextAccount() : undefined,
            rangeRecord: data.rangeProofInstructionOffset === 0 ? getNextAccount() : undefined,
            authority: getNextAccount(),
        },
        data,
    };
}
