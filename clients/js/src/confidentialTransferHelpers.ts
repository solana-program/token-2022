import {
    closeContextStateProof,
    verifyBatchedGroupedCiphertext3HandlesValidity,
    verifyBatchedRangeProofU128,
    verifyBatchedRangeProofU64,
    verifyCiphertextCommitmentEquality,
    verifyPubkeyValidity,
    verifyZeroCiphertext,
} from '@solana-program/zk-elgamal-proof';
import {
    Address,
    Instruction,
    TransactionSigner,
    generateKeyPairSigner,
    getAddressEncoder,
    isSome,
    nonDivisibleSequentialInstructionPlan,
    parallelInstructionPlan,
    sequentialInstructionPlan,
    type GetMinimumBalanceForRentExemptionApi,
    type FetchAccountConfig,
    type InstructionPlan,
    type ReadonlyUint8Array,
    type Rpc,
} from '@solana/kit';
import {
    AeCiphertext,
    AeKey,
    BatchedGroupedCiphertext3HandlesValidityProofData,
    BatchedRangeProofU128Data,
    BatchedRangeProofU64Data,
    CiphertextCommitmentEqualityProofData,
    ElGamalCiphertext,
    ElGamalKeypair,
    ElGamalPubkey,
    ElGamalSecretKey,
    GroupedElGamalCiphertext3Handles,
    PedersenCommitment,
    PedersenOpening,
    PubkeyValidityProofData,
    ZeroCiphertextProofData,
} from '@solana/zk-sdk/bundler';

import {
    extractCiphertextFromGroupedBytes,
    subtractAmountFromCiphertext,
    subtractWithLoHiCiphertexts,
} from './confidentialTransferArithmetic';
import {
    ExtensionType,
    Extension,
    TOKEN_2022_PROGRAM_ADDRESS,
    Token,
    findAssociatedTokenPda,
    getApplyConfidentialPendingBalanceInstruction,
    getConfidentialTransferInstruction,
    getConfidentialWithdrawInstruction,
    getConfigureConfidentialTransferAccountInstruction,
    getCreateAssociatedTokenIdempotentInstruction,
    getEmptyConfidentialTransferAccountInstruction,
    getReallocateInstruction,
    fetchToken,
} from './generated';

const DEFAULT_MAXIMUM_PENDING_BALANCE_CREDIT_COUNTER = 1n << 16n;
const PENDING_BALANCE_LO_BIT_LENGTH = 16n;
const TRANSFER_AMOUNT_LO_BIT_LENGTH = 16n;
const TRANSFER_AMOUNT_HI_BIT_LENGTH = 32n;
const REMAINING_BALANCE_BIT_LENGTH = 64;
const RANGE_PROOF_PADDING_BIT_LENGTH = 16;

type ConfidentialTransferAccountExtension = Extract<Extension, { __kind: 'ConfidentialTransferAccount' }>;

type ContextStateProofMode = {
    /**
     * The strategy used to provide zero-knowledge proofs to the program.
     *
     * Currently, only `context-state` is supported, where each proof is verified
     * into a dedicated context-state account before the instruction is executed.
     * Additional modes — such as `instruction-data`, where proofs are provided
     * inline within the same transaction — may be supported in the future.
     */
    proofMode?: 'context-state';
    payer: TransactionSigner;
    rpc: Rpc<GetMinimumBalanceForRentExemptionApi>;
};

export type GetCreateConfidentialTransferAccountInstructionPlanInput = {
    payer: TransactionSigner;
    owner: Address | TransactionSigner;
    mint: Address;
    token?: Address;
    authority?: Address | TransactionSigner;
    rpc: Rpc<GetMinimumBalanceForRentExemptionApi>;
    elgamalKeypair: ElGamalKeypair;
    aesKey: AeKey;
    maximumPendingBalanceCreditCounter?: number | bigint;
    multiSigners?: Array<TransactionSigner>;
    programAddress?: Address;
};

export type GetApplyConfidentialPendingBalanceInstructionFromTokenInput = {
    token: Address;
    tokenAccount: Token;
    authority: Address | TransactionSigner;
    elgamalSecretKey: ElGamalSecretKey;
    aesKey: AeKey;
    multiSigners?: Array<TransactionSigner>;
    programAddress?: Address;
};

export type DecryptConfidentialTransferBalanceInput = {
    tokenAccount: Token;
    elgamalSecretKey: ElGamalSecretKey;
    aesKey: AeKey;
};

export type FetchConfidentialTransferBalanceInput = Omit<DecryptConfidentialTransferBalanceInput, 'tokenAccount'> & {
    token: Address;
    rpc: Parameters<typeof fetchToken>[0];
    config?: FetchAccountConfig;
};

export type ConfidentialTransferBalance = {
    availableBalance: bigint;
    pendingBalance: bigint;
    totalBalance: bigint;
    pendingBalanceCreditCounter: bigint;
    maximumPendingBalanceCreditCounter: bigint;
    expectedPendingBalanceCreditCounter: bigint;
    actualPendingBalanceCreditCounter: bigint;
};

type GetConfidentialWithdrawInstructionPlanBaseInput = {
    token: Address;
    mint: Address;
    tokenAccount: Token;
    authority: Address | TransactionSigner;
    amount: number | bigint;
    decimals: number;
    elgamalKeypair: ElGamalKeypair;
    aesKey: AeKey;
    multiSigners?: Array<TransactionSigner>;
    programAddress?: Address;
};

export type GetConfidentialWithdrawInstructionPlanInput = GetConfidentialWithdrawInstructionPlanBaseInput &
    ContextStateProofMode;

export type GetEmptyConfidentialTransferAccountInstructionPlanInput = {
    token: Address;
    tokenAccount: Token;
    authority: Address | TransactionSigner;
    elgamalKeypair: ElGamalKeypair;
    multiSigners?: Array<TransactionSigner>;
    programAddress?: Address;
} & ContextStateProofMode;

type GetConfidentialTransferInstructionPlanBaseInput = {
    sourceToken: Address;
    mint: Address;
    destinationToken: Address;
    sourceTokenAccount: Token;
    auditorElgamalPubkey?: Address;
    authority: Address | TransactionSigner;
    amount: number | bigint;
    sourceElgamalKeypair: ElGamalKeypair;
    aesKey: AeKey;
    multiSigners?: Array<TransactionSigner>;
    programAddress?: Address;
} & (
    | { destinationTokenAccount: Token; destinationElgamalPubkey?: Address }
    | { destinationElgamalPubkey: Address; destinationTokenAccount?: never }
);

export type GetConfidentialTransferInstructionPlanInput = GetConfidentialTransferInstructionPlanBaseInput &
    ContextStateProofMode;

function getTokenProgramAddress(programAddress?: Address) {
    return programAddress ?? TOKEN_2022_PROGRAM_ADDRESS;
}

function addressOf(value: Address | TransactionSigner): Address {
    return isSigner(value) ? value.address : value;
}

function isSigner(value: Address | TransactionSigner): value is TransactionSigner {
    return typeof value !== 'string';
}

function getRequiredConfidentialTransferAccountExtension(tokenAccount: Token): ConfidentialTransferAccountExtension {
    if (!isSome(tokenAccount.extensions)) {
        throw new Error('Token account is missing extensions.');
    }

    const extension = tokenAccount.extensions.value.find(
        candidate => candidate.__kind === 'ConfidentialTransferAccount',
    ) as ConfidentialTransferAccountExtension | undefined;
    if (!extension) {
        throw new Error('Token account is missing the ConfidentialTransferAccount extension.');
    }

    return extension;
}

function parseAeCiphertext(bytes: ReadonlyUint8Array) {
    const ciphertext = AeCiphertext.fromBytes(new Uint8Array(bytes));
    if (!ciphertext) {
        throw new Error('Failed to deserialize an authenticated-encryption ciphertext.');
    }
    return ciphertext;
}

function parseElGamalCiphertext(bytes: ReadonlyUint8Array) {
    const ciphertext = ElGamalCiphertext.fromBytes(new Uint8Array(bytes));
    if (!ciphertext) {
        throw new Error('Failed to deserialize an ElGamal ciphertext.');
    }
    return ciphertext;
}

function getElGamalPubkeyFromAddress(value: Address) {
    return ElGamalPubkey.fromBytes(getAddressEncoder().encode(value) as Uint8Array);
}

function getDefaultAuditorElGamalPubkey() {
    return ElGamalPubkey.fromBytes(new Uint8Array(32));
}

function getDestinationElGamalPubkey(input: GetConfidentialTransferInstructionPlanInput) {
    if (input.destinationElgamalPubkey) {
        return getElGamalPubkeyFromAddress(input.destinationElgamalPubkey);
    }
    if (!input.destinationTokenAccount) {
        throw new Error('Destination confidential transfer state is required.');
    }

    return getElGamalPubkeyFromAddress(
        getRequiredConfidentialTransferAccountExtension(input.destinationTokenAccount).elgamalPubkey,
    );
}

function splitAmount(amount: bigint, bitLength: bigint): [bigint, bigint] {
    const mask = (1n << bitLength) - 1n;
    return [amount & mask, amount >> bitLength];
}

function combineAmounts(amountLo: bigint, amountHi: bigint, bitLength: bigint): bigint {
    return (amountHi << bitLength) + amountLo;
}

function decryptAvailableBalance(account: ConfidentialTransferAccountExtension, aesKey: AeKey) {
    return aesKey.decrypt(parseAeCiphertext(account.decryptableAvailableBalance));
}

function decryptPendingBalance(account: ConfidentialTransferAccountExtension, elgamalSecretKey: ElGamalSecretKey) {
    const pendingBalanceLo = elgamalSecretKey.decrypt(parseElGamalCiphertext(account.pendingBalanceLow));
    const pendingBalanceHi = elgamalSecretKey.decrypt(parseElGamalCiphertext(account.pendingBalanceHigh));
    return combineAmounts(pendingBalanceLo, pendingBalanceHi, PENDING_BALANCE_LO_BIT_LENGTH);
}

function assertCreateHelperOwnerMatchesAuthority(
    owner: Address | TransactionSigner,
    authority: Address | TransactionSigner,
) {
    if (addressOf(owner) !== addressOf(authority)) {
        throw new Error(
            'This helper is scoped to the token-account owner. For the ATA convenience flow, authority must match owner.',
        );
    }
}

/**
 * Builds the setup-and-cleanup instruction plans for a single proof's
 * context-state account. The setup plan creates the context-state account
 * and verifies the proof into it (these two instructions must share a
 * transaction). The cleanup plan closes the context-state account to recover
 * its rent.
 */
function assertNonNegativeAmount(amount: bigint): void {
    if (amount < 0n) {
        throw new Error('Amount must be non-negative.');
    }
}

function computeNewAvailableBalance(currentBalance: bigint, amount: bigint): bigint {
    assertNonNegativeAmount(amount);
    const newBalance = currentBalance - amount;
    if (newBalance < 0n) {
        throw new Error('Insufficient funds.');
    }
    return newBalance;
}

async function buildContextStateProofPlan(
    proofData: ReadonlyUint8Array,
    verifyAction: (args: {
        rpc: Rpc<GetMinimumBalanceForRentExemptionApi>;
        payer: TransactionSigner;
        proofData: Uint8Array;
        contextState: { contextAccount: Awaited<ReturnType<typeof generateKeyPairSigner>>; authority: Address };
    }) => Promise<Instruction[]>,
    payer: TransactionSigner,
    rpc: Rpc<GetMinimumBalanceForRentExemptionApi>,
    contextStateAuthority: TransactionSigner = payer,
): Promise<{ address: Address; setup: InstructionPlan; cleanup: Instruction }> {
    const contextAccount = await generateKeyPairSigner();
    const setupInstructions = await verifyAction({
        rpc,
        payer,
        proofData: new Uint8Array(proofData),
        contextState: { contextAccount, authority: contextStateAuthority.address },
    });
    return {
        address: contextAccount.address,
        // Divisible: the create-account and verify-proof instructions can fit
        // in one transaction for small proofs (e.g. PubkeyValidity) but exceed
        // the size limit for larger proofs (e.g. BatchedRangeProofU128). A
        // transaction planner decides how to pack them; the verify only needs
        // the account to exist, which is true once create-account is confirmed.
        setup: sequentialInstructionPlan(setupInstructions),
        cleanup: closeContextStateProof({
            contextState: contextAccount.address,
            authority: contextStateAuthority,
            destination: payer.address,
        }),
    };
}

/**
 * Returns a single-transaction plan that creates the ATA, reallocates it
 * for the confidential-transfer extension, configures the account, and
 * verifies the ZK pubkey-validity proof.
 */
export async function getCreateConfidentialTransferAccountInstructionPlan(
    input: GetCreateConfidentialTransferAccountInstructionPlanInput,
): Promise<InstructionPlan> {
    const programAddress = getTokenProgramAddress(input.programAddress);
    const authority = input.authority ?? input.owner;
    assertCreateHelperOwnerMatchesAuthority(input.owner, authority);

    const ownerAddress = addressOf(input.owner);
    const token =
        input.token ??
        (
            await findAssociatedTokenPda({
                owner: ownerAddress,
                tokenProgram: programAddress,
                mint: input.mint,
            })
        )[0];

    const pubkeyValidityProofData = new PubkeyValidityProofData(input.elgamalKeypair);
    const [verifyProofInstruction] = await verifyPubkeyValidity({
        rpc: input.rpc,
        payer: input.payer,
        proofData: new Uint8Array(pubkeyValidityProofData.toBytes()),
    });

    return nonDivisibleSequentialInstructionPlan([
        getCreateAssociatedTokenIdempotentInstruction({
            ata: token,
            mint: input.mint,
            owner: ownerAddress,
            payer: input.payer,
            tokenProgram: programAddress,
        }),
        getReallocateInstruction(
            {
                token,
                payer: input.payer,
                owner: authority,
                newExtensionTypes: [ExtensionType.ConfidentialTransferAccount],
                multiSigners: input.multiSigners,
            },
            { programAddress },
        ),
        getConfigureConfidentialTransferAccountInstruction(
            {
                token,
                mint: input.mint,
                authority,
                decryptableZeroBalance: input.aesKey.encrypt(0n).toBytes(),
                maximumPendingBalanceCreditCounter:
                    input.maximumPendingBalanceCreditCounter ?? DEFAULT_MAXIMUM_PENDING_BALANCE_CREDIT_COUNTER,
                proofInstructionOffset: 1,
                multiSigners: input.multiSigners,
            },
            { programAddress },
        ),
        verifyProofInstruction,
    ]);
}

/**
 * Decrypts a decoded token account's confidential-transfer balances.
 */
export function decryptConfidentialTransferBalance(
    input: DecryptConfidentialTransferBalanceInput,
): ConfidentialTransferBalance {
    const account = getRequiredConfidentialTransferAccountExtension(input.tokenAccount);
    const availableBalance = decryptAvailableBalance(account, input.aesKey);
    const pendingBalance = decryptPendingBalance(account, input.elgamalSecretKey);
    return {
        availableBalance,
        pendingBalance,
        totalBalance: availableBalance + pendingBalance,
        pendingBalanceCreditCounter: account.pendingBalanceCreditCounter,
        maximumPendingBalanceCreditCounter: account.maximumPendingBalanceCreditCounter,
        expectedPendingBalanceCreditCounter: account.expectedPendingBalanceCreditCounter,
        actualPendingBalanceCreditCounter: account.actualPendingBalanceCreditCounter,
    };
}

/**
 * Fetches a token account and decrypts its confidential-transfer balances.
 */
export async function fetchConfidentialTransferBalance(
    input: FetchConfidentialTransferBalanceInput,
): Promise<ConfidentialTransferBalance> {
    const { data: tokenAccount } = await fetchToken(input.rpc, input.token, input.config);
    return decryptConfidentialTransferBalance({
        tokenAccount,
        elgamalSecretKey: input.elgamalSecretKey,
        aesKey: input.aesKey,
    });
}

/**
 * Builds an `ApplyPendingBalance` instruction plan from a decoded token
 * account, decrypting the pending balance and re-encrypting the new
 * available balance locally.
 */
export function getApplyConfidentialPendingBalanceInstructionFromToken(
    input: GetApplyConfidentialPendingBalanceInstructionFromTokenInput,
): Instruction {
    const account = getRequiredConfidentialTransferAccountExtension(input.tokenAccount);
    const pendingBalance = decryptPendingBalance(account, input.elgamalSecretKey);
    const newDecryptableAvailableBalance = input.aesKey
        .encrypt(decryptAvailableBalance(account, input.aesKey) + pendingBalance)
        .toBytes();

    return getApplyConfidentialPendingBalanceInstruction(
        {
            token: input.token,
            authority: input.authority,
            expectedPendingBalanceCreditCounter: account.pendingBalanceCreditCounter,
            newDecryptableAvailableBalance,
            multiSigners: input.multiSigners,
        },
        { programAddress: getTokenProgramAddress(input.programAddress) },
    );
}

/**
 * Returns an instruction plan that empties the confidential-transfer
 * extension state once the available encrypted balance decrypts to zero.
 */
export async function getEmptyConfidentialTransferAccountInstructionPlan(
    input: GetEmptyConfidentialTransferAccountInstructionPlanInput,
): Promise<InstructionPlan> {
    const account = getRequiredConfidentialTransferAccountExtension(input.tokenAccount);
    const zeroCiphertextProofData = new ZeroCiphertextProofData(
        input.elgamalKeypair,
        parseElGamalCiphertext(account.availableBalance),
    );
    const proofPlan = await buildContextStateProofPlan(
        zeroCiphertextProofData.toBytes(),
        verifyZeroCiphertext,
        input.payer,
        input.rpc,
    );

    return sequentialInstructionPlan([
        proofPlan.setup,
        getEmptyConfidentialTransferAccountInstruction(
            {
                token: input.token,
                instructionsSysvarOrContextState: proofPlan.address,
                authority: input.authority,
                proofInstructionOffset: 0,
                multiSigners: input.multiSigners,
            },
            { programAddress: getTokenProgramAddress(input.programAddress) },
        ),
        proofPlan.cleanup,
    ]);
}

/**
 * Returns an instruction plan that moves tokens from the encrypted
 * available balance back to the plaintext balance. Generates and verifies
 * the equality and batched range proofs via context-state accounts.
 */
export async function getConfidentialWithdrawInstructionPlan(
    input: GetConfidentialWithdrawInstructionPlanInput,
): Promise<InstructionPlan> {
    const account = getRequiredConfidentialTransferAccountExtension(input.tokenAccount);
    const amount = BigInt(input.amount);
    assertNonNegativeAmount(amount);
    const newAvailableBalance = computeNewAvailableBalance(decryptAvailableBalance(account, input.aesKey), amount);

    const remainingBalanceOpening = new PedersenOpening();
    const remainingBalanceCommitment = PedersenCommitment.from(newAvailableBalance, remainingBalanceOpening);
    const remainingBalanceCiphertext = parseElGamalCiphertext(
        subtractAmountFromCiphertext(account.availableBalance, amount),
    );

    const equalityProofData = new CiphertextCommitmentEqualityProofData(
        input.elgamalKeypair,
        remainingBalanceCiphertext,
        remainingBalanceCommitment,
        remainingBalanceOpening,
        newAvailableBalance,
    );
    const rangeProofData = new BatchedRangeProofU64Data(
        [remainingBalanceCommitment],
        new BigUint64Array([newAvailableBalance]),
        Uint8Array.from([REMAINING_BALANCE_BIT_LENGTH]),
        [remainingBalanceOpening],
    );

    const [equalityProofPlan, rangeProofPlan] = await Promise.all([
        buildContextStateProofPlan(
            equalityProofData.toBytes(),
            verifyCiphertextCommitmentEquality,
            input.payer,
            input.rpc,
        ),
        buildContextStateProofPlan(rangeProofData.toBytes(), verifyBatchedRangeProofU64, input.payer, input.rpc),
    ]);

    return sequentialInstructionPlan([
        parallelInstructionPlan([equalityProofPlan.setup, rangeProofPlan.setup]),
        getConfidentialWithdrawInstruction(
            {
                token: input.token,
                mint: input.mint,
                equalityRecord: equalityProofPlan.address,
                rangeRecord: rangeProofPlan.address,
                authority: input.authority,
                amount,
                decimals: input.decimals,
                newDecryptableAvailableBalance: input.aesKey.encrypt(newAvailableBalance).toBytes(),
                equalityProofInstructionOffset: 0,
                rangeProofInstructionOffset: 0,
                multiSigners: input.multiSigners,
            },
            { programAddress: input.programAddress ?? TOKEN_2022_PROGRAM_ADDRESS },
        ),
        parallelInstructionPlan([equalityProofPlan.cleanup, rangeProofPlan.cleanup]),
    ]);
}

/**
 * Returns an instruction plan that confidentially transfers tokens between
 * two accounts. Splits the amount into lo/hi halves and verifies the three
 * required proofs (equality, grouped-ciphertext validity, batched range)
 * via context-state accounts.
 */
export async function getConfidentialTransferInstructionPlan(
    input: GetConfidentialTransferInstructionPlanInput,
): Promise<InstructionPlan> {
    const sourceAccount = getRequiredConfidentialTransferAccountExtension(input.sourceTokenAccount);
    const amount = BigInt(input.amount);
    assertNonNegativeAmount(amount);
    const [transferAmountLo, transferAmountHi] = splitAmount(amount, TRANSFER_AMOUNT_LO_BIT_LENGTH);

    const sourcePubkey = input.sourceElgamalKeypair.pubkey();
    const destinationPubkey = getDestinationElGamalPubkey(input);
    const auditorPubkey = input.auditorElgamalPubkey
        ? getElGamalPubkeyFromAddress(input.auditorElgamalPubkey)
        : getDefaultAuditorElGamalPubkey();

    const openingLo = new PedersenOpening();
    const openingHi = new PedersenOpening();
    const groupedCiphertextLo = GroupedElGamalCiphertext3Handles.encryptWith(
        sourcePubkey,
        destinationPubkey,
        auditorPubkey,
        transferAmountLo,
        openingLo,
    );
    const groupedCiphertextHi = GroupedElGamalCiphertext3Handles.encryptWith(
        sourcePubkey,
        destinationPubkey,
        auditorPubkey,
        transferAmountHi,
        openingHi,
    );

    const groupedCiphertextLoBytes = groupedCiphertextLo.toBytes();
    const groupedCiphertextHiBytes = groupedCiphertextHi.toBytes();
    const transferAmountSourceCiphertextLo = extractCiphertextFromGroupedBytes(groupedCiphertextLoBytes, 0);
    const transferAmountSourceCiphertextHi = extractCiphertextFromGroupedBytes(groupedCiphertextHiBytes, 0);
    const transferAmountAuditorCiphertextLo = extractCiphertextFromGroupedBytes(groupedCiphertextLoBytes, 2);
    const transferAmountAuditorCiphertextHi = extractCiphertextFromGroupedBytes(groupedCiphertextHiBytes, 2);

    const newAvailableBalance = computeNewAvailableBalance(
        decryptAvailableBalance(sourceAccount, input.aesKey),
        amount,
    );
    const newAvailableBalanceOpening = new PedersenOpening();
    const newAvailableBalanceCommitment = PedersenCommitment.from(newAvailableBalance, newAvailableBalanceOpening);
    const newAvailableBalanceCiphertext = parseElGamalCiphertext(
        subtractWithLoHiCiphertexts(
            sourceAccount.availableBalance,
            transferAmountSourceCiphertextLo,
            transferAmountSourceCiphertextHi,
            TRANSFER_AMOUNT_LO_BIT_LENGTH,
        ),
    );

    const equalityProofData = new CiphertextCommitmentEqualityProofData(
        input.sourceElgamalKeypair,
        newAvailableBalanceCiphertext,
        newAvailableBalanceCommitment,
        newAvailableBalanceOpening,
        newAvailableBalance,
    );
    const ciphertextValidityProofData = new BatchedGroupedCiphertext3HandlesValidityProofData(
        sourcePubkey,
        destinationPubkey,
        auditorPubkey,
        groupedCiphertextLo,
        groupedCiphertextHi,
        transferAmountLo,
        transferAmountHi,
        openingLo,
        openingHi,
    );

    const commitmentLo = PedersenCommitment.fromBytes(groupedCiphertextLoBytes.slice(0, 32));
    const commitmentHi = PedersenCommitment.fromBytes(groupedCiphertextHiBytes.slice(0, 32));
    const paddingOpening = new PedersenOpening();
    const paddingCommitment = PedersenCommitment.from(0n, paddingOpening);
    const rangeProofData = new BatchedRangeProofU128Data(
        [newAvailableBalanceCommitment, commitmentLo, commitmentHi, paddingCommitment],
        new BigUint64Array([newAvailableBalance, transferAmountLo, transferAmountHi, 0n]),
        Uint8Array.from([
            REMAINING_BALANCE_BIT_LENGTH,
            Number(TRANSFER_AMOUNT_LO_BIT_LENGTH),
            Number(TRANSFER_AMOUNT_HI_BIT_LENGTH),
            RANGE_PROOF_PADDING_BIT_LENGTH,
        ]),
        [newAvailableBalanceOpening, openingLo, openingHi, paddingOpening],
    );

    const [equalityProofPlan, ciphertextValidityProofPlan, rangeProofPlan] = await Promise.all([
        buildContextStateProofPlan(
            equalityProofData.toBytes(),
            verifyCiphertextCommitmentEquality,
            input.payer,
            input.rpc,
        ),
        buildContextStateProofPlan(
            ciphertextValidityProofData.toBytes(),
            verifyBatchedGroupedCiphertext3HandlesValidity,
            input.payer,
            input.rpc,
        ),
        buildContextStateProofPlan(rangeProofData.toBytes(), verifyBatchedRangeProofU128, input.payer, input.rpc),
    ]);

    return sequentialInstructionPlan([
        parallelInstructionPlan([equalityProofPlan.setup, ciphertextValidityProofPlan.setup, rangeProofPlan.setup]),
        getConfidentialTransferInstruction(
            {
                sourceToken: input.sourceToken,
                mint: input.mint,
                destinationToken: input.destinationToken,
                equalityRecord: equalityProofPlan.address,
                ciphertextValidityRecord: ciphertextValidityProofPlan.address,
                rangeRecord: rangeProofPlan.address,
                authority: input.authority,
                newSourceDecryptableAvailableBalance: input.aesKey.encrypt(newAvailableBalance).toBytes(),
                transferAmountAuditorCiphertextLo,
                transferAmountAuditorCiphertextHi,
                equalityProofInstructionOffset: 0,
                ciphertextValidityProofInstructionOffset: 0,
                rangeProofInstructionOffset: 0,
                multiSigners: input.multiSigners,
            },
            { programAddress: input.programAddress ?? TOKEN_2022_PROGRAM_ADDRESS },
        ),
        parallelInstructionPlan([
            equalityProofPlan.cleanup,
            ciphertextValidityProofPlan.cleanup,
            rangeProofPlan.cleanup,
        ]),
    ]);
}
