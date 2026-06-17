import {
    closeContextStateProof,
    verifyBatchedGroupedCiphertext2HandlesValidity,
    verifyBatchedGroupedCiphertext3HandlesValidity,
    verifyBatchedRangeProofU128,
    verifyBatchedRangeProofU256,
    verifyBatchedRangeProofU64,
    verifyCiphertextCommitmentEquality,
    verifyPercentageWithCap,
    verifyPubkeyValidity,
} from '@solana-program/zk-elgamal-proof';
import {
    RECORD_CHUNK_SIZE_POST_INITIALIZE,
    RECORD_META_DATA_SIZE,
    createCloseRecordInstruction,
    createRecord,
    createWriteInstruction,
} from '@solana-program/record';
import {
    Address,
    Instruction,
    KeyPairSigner,
    TransactionSigner,
    generateKeyPairSigner,
    getAddressEncoder,
    isSome,
    nonDivisibleSequentialInstructionPlan,
    parallelInstructionPlan,
    sequentialInstructionPlan,
    singleInstructionPlan,
    type GetMinimumBalanceForRentExemptionApi,
    type InstructionPlan,
    type ReadonlyUint8Array,
    type Rpc,
} from '@solana/kit';
import {
    AeCiphertext,
    AeKey,
    BatchedGroupedCiphertext2HandlesValidityProofData,
    BatchedGroupedCiphertext3HandlesValidityProofData,
    BatchedRangeProofU128Data,
    BatchedRangeProofU256Data,
    BatchedRangeProofU64Data,
    CiphertextCommitmentEqualityProofData,
    ElGamalCiphertext,
    ElGamalKeypair,
    ElGamalPubkey,
    ElGamalSecretKey,
    GroupedElGamalCiphertext2Handles,
    GroupedElGamalCiphertext3Handles,
    PedersenCommitment,
    PedersenOpening,
    PercentageWithCapProofData,
    PubkeyValidityProofData,
} from '@solana/zk-sdk/bundler';

import {
    extractCiphertextFromGroupedBytes,
    subtractAmountFromCiphertext,
    subtractWithLoHiCiphertexts,
} from './confidentialTransferArithmetic';
import {
    ExtensionType,
    Extension,
    Mint,
    TOKEN_2022_PROGRAM_ADDRESS,
    Token,
    findAssociatedTokenPda,
    getApplyConfidentialPendingBalanceInstruction,
    getConfidentialTransferInstruction,
    getConfidentialTransferWithFeeInstruction,
    getConfidentialWithdrawInstruction,
    getConfigureConfidentialTransferAccountInstruction,
    getCreateAssociatedTokenIdempotentInstruction,
    getReallocateInstruction,
} from './generated';

const DEFAULT_MAXIMUM_PENDING_BALANCE_CREDIT_COUNTER = 1n << 16n;
const PENDING_BALANCE_LO_BIT_LENGTH = 16n;
const TRANSFER_AMOUNT_LO_BIT_LENGTH = 16n;
const TRANSFER_AMOUNT_HI_BIT_LENGTH = 32n;
const FEE_AMOUNT_LO_BIT_LENGTH = 16n;
const FEE_AMOUNT_HI_BIT_LENGTH = 32n;
const REMAINING_BALANCE_BIT_LENGTH = 64;
const RANGE_PROOF_PADDING_BIT_LENGTH = 16;
const MAX_FEE_BASIS_POINTS_SUB_ONE = 9_999n;
const MAX_FEE_BASIS_POINTS = 10_000n;
const DELTA_BIT_LENGTH = 16;
const NET_TRANSFER_AMOUNT_BIT_LENGTH = 64;
const COMPUTE_BUDGET_PROGRAM_ADDRESS =
    'ComputeBudget111111111111111111111111111111' as Address<'ComputeBudget111111111111111111111111111111'>;
const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;

type ConfidentialTransferAccountExtension = Extract<Extension, { __kind: 'ConfidentialTransferAccount' }>;
type TransferFeeConfigExtension = Extract<Extension, { __kind: 'TransferFeeConfig' }>;
type TransferFee = TransferFeeConfigExtension['olderTransferFee'];
type PedersenCommitmentWithArithmetic = PedersenCommitment & {
    subtract(other: PedersenCommitment): PedersenCommitment;
    multiplyByU64(scalar: bigint): PedersenCommitment;
};
type PedersenCommitmentConstructorWithArithmetic = typeof PedersenCommitment & {
    combineLoHi(lo: PedersenCommitment, hi: PedersenCommitment, bitLength: number): PedersenCommitment;
};
type PedersenOpeningWithArithmetic = PedersenOpening & {
    subtract(other: PedersenOpening): PedersenOpening;
    multiplyByU64(scalar: bigint): PedersenOpening;
};
type PedersenOpeningConstructorWithArithmetic = typeof PedersenOpening & {
    zero(): PedersenOpening;
    combineLoHi(lo: PedersenOpening, hi: PedersenOpening, bitLength: number): PedersenOpening;
};
type ProofDataInput = Uint8Array | { account: Address; offset: number };
type ContextStateProofPlan = Readonly<{ address: Address; setup: InstructionPlan; cleanup: InstructionPlan }>;

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
    includeConfidentialTransferFeeAmount?: boolean;
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

type GetConfidentialTransferWithFeeInstructionPlanBaseInput = GetConfidentialTransferInstructionPlanBaseInput & {
    mintAccount: Mint;
    currentEpoch: number | bigint;
};

export type GetConfidentialTransferWithFeeInstructionPlanInput =
    GetConfidentialTransferWithFeeInstructionPlanBaseInput & ContextStateProofMode;

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

function getRequiredMintExtension<TKind extends Extension['__kind']>(
    mintAccount: Mint,
    kind: TKind,
): Extract<Extension, { __kind: TKind }> {
    if (!isSome(mintAccount.extensions)) {
        throw new Error('Mint account is missing extensions.');
    }

    const extension = mintAccount.extensions.value.find(candidate => candidate.__kind === kind) as
        | Extract<Extension, { __kind: TKind }>
        | undefined;
    if (!extension) {
        throw new Error(`Mint account is missing the ${kind} extension.`);
    }

    return extension;
}

function getOptionalMintExtension<TKind extends Extension['__kind']>(
    mintAccount: Mint,
    kind: TKind,
): Extract<Extension, { __kind: TKind }> | undefined {
    if (!isSome(mintAccount.extensions)) {
        return;
    }

    return mintAccount.extensions.value.find(candidate => candidate.__kind === kind) as
        | Extract<Extension, { __kind: TKind }>
        | undefined;
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

function getAuditorElGamalPubkey(input: { auditorElgamalPubkey?: Address; mintAccount?: Mint }) {
    if (input.auditorElgamalPubkey) {
        return getElGamalPubkeyFromAddress(input.auditorElgamalPubkey);
    }

    const confidentialTransferMint = input.mintAccount
        ? getOptionalMintExtension(input.mintAccount, 'ConfidentialTransferMint')
        : undefined;
    if (confidentialTransferMint && isSome(confidentialTransferMint.auditorElgamalPubkey)) {
        return getElGamalPubkeyFromAddress(confidentialTransferMint.auditorElgamalPubkey.value);
    }

    return getDefaultAuditorElGamalPubkey();
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

function assertU64Amount(amount: bigint, name: string): void {
    if (amount > (1n << 64n) - 1n) {
        throw new Error(`${name} must fit in a u64.`);
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

function getEpochTransferFee(
    transferFeeConfig: TransferFeeConfigExtension,
    currentEpoch: number | bigint,
): TransferFee {
    return BigInt(currentEpoch) >= transferFeeConfig.newerTransferFee.epoch
        ? transferFeeConfig.newerTransferFee
        : transferFeeConfig.olderTransferFee;
}

function calculateFee(transferAmount: bigint, transferFeeBasisPoints: number): [bigint, bigint] {
    const numerator = transferAmount * BigInt(transferFeeBasisPoints);
    const fee = (numerator + MAX_FEE_BASIS_POINTS - 1n) / MAX_FEE_BASIS_POINTS;
    const deltaFee = fee * MAX_FEE_BASIS_POINTS - numerator;
    return [fee, deltaFee];
}

function calculateTransferWithFeeAmounts(transferAmount: bigint, transferFeeBasisPoints: number, maximumFee: bigint) {
    const [rawFeeAmount, rawDeltaFee] = calculateFee(transferAmount, transferFeeBasisPoints);
    const [feeAmount, claimedDeltaFee] = maximumFee < rawFeeAmount ? [maximumFee, 0n] : [rawFeeAmount, rawDeltaFee];
    const netTransferAmount = transferAmount - feeAmount;
    if (netTransferAmount < 0n) {
        throw new Error('Fee exceeds transfer amount.');
    }

    return { feeAmount, claimedDeltaFee, netTransferAmount };
}

function combineLoHiCommitments(lo: PedersenCommitment, hi: PedersenCommitment, bitLength: bigint): PedersenCommitment {
    const PedersenCommitmentWithArithmetic =
        PedersenCommitment as unknown as PedersenCommitmentConstructorWithArithmetic;
    if (typeof PedersenCommitmentWithArithmetic.combineLoHi !== 'function') {
        throw new Error('Confidential transfer with fee requires @solana/zk-sdk Pedersen commitment arithmetic.');
    }
    return PedersenCommitmentWithArithmetic.combineLoHi(lo, hi, Number(bitLength));
}

function combineLoHiOpenings(lo: PedersenOpening, hi: PedersenOpening, bitLength: bigint): PedersenOpening {
    const PedersenOpeningWithArithmetic = PedersenOpening as unknown as PedersenOpeningConstructorWithArithmetic;
    if (typeof PedersenOpeningWithArithmetic.combineLoHi !== 'function') {
        throw new Error('Confidential transfer with fee requires @solana/zk-sdk Pedersen opening arithmetic.');
    }
    return PedersenOpeningWithArithmetic.combineLoHi(lo, hi, Number(bitLength));
}

function getZeroOpening(): PedersenOpening {
    const PedersenOpeningWithArithmetic = PedersenOpening as unknown as PedersenOpeningConstructorWithArithmetic;
    if (typeof PedersenOpeningWithArithmetic.zero !== 'function') {
        throw new Error('Confidential transfer with fee requires @solana/zk-sdk Pedersen opening arithmetic.');
    }
    return PedersenOpeningWithArithmetic.zero();
}

function subtractCommitments(left: PedersenCommitment, right: PedersenCommitment): PedersenCommitment {
    const leftWithArithmetic = left as PedersenCommitmentWithArithmetic;
    if (typeof leftWithArithmetic.subtract !== 'function') {
        throw new Error('Confidential transfer with fee requires @solana/zk-sdk Pedersen commitment arithmetic.');
    }
    return leftWithArithmetic.subtract(right);
}

function subtractOpenings(left: PedersenOpening, right: PedersenOpening): PedersenOpening {
    const leftWithArithmetic = left as PedersenOpeningWithArithmetic;
    if (typeof leftWithArithmetic.subtract !== 'function') {
        throw new Error('Confidential transfer with fee requires @solana/zk-sdk Pedersen opening arithmetic.');
    }
    return leftWithArithmetic.subtract(right);
}

function multiplyCommitment(commitment: PedersenCommitment, scalar: bigint): PedersenCommitment {
    const commitmentWithArithmetic = commitment as PedersenCommitmentWithArithmetic;
    if (typeof commitmentWithArithmetic.multiplyByU64 !== 'function') {
        throw new Error('Confidential transfer with fee requires @solana/zk-sdk Pedersen commitment arithmetic.');
    }
    return commitmentWithArithmetic.multiplyByU64(scalar);
}

function multiplyOpening(opening: PedersenOpening, scalar: bigint): PedersenOpening {
    const openingWithArithmetic = opening as PedersenOpeningWithArithmetic;
    if (typeof openingWithArithmetic.multiplyByU64 !== 'function') {
        throw new Error('Confidential transfer with fee requires @solana/zk-sdk Pedersen opening arithmetic.');
    }
    return openingWithArithmetic.multiplyByU64(scalar);
}

function getRecordWriteInstructions(
    recordAccount: Address,
    authority: TransactionSigner,
    proofData: Uint8Array,
): Instruction[] {
    const instructions: Instruction[] = [];
    for (let offset = 0; offset < proofData.length; offset += RECORD_CHUNK_SIZE_POST_INITIALIZE) {
        instructions.push(
            createWriteInstruction({
                recordAccount,
                authority,
                offset: BigInt(offset),
                data: proofData.slice(offset, offset + RECORD_CHUNK_SIZE_POST_INITIALIZE),
            }),
        );
    }
    return instructions;
}

function getSetComputeUnitLimitInstruction(units: number): Instruction {
    const data = new Uint8Array(5);
    data[0] = 2;
    new DataView(data.buffer).setUint32(1, units, true);
    return { programAddress: COMPUTE_BUDGET_PROGRAM_ADDRESS, data };
}

async function buildContextStateProofPlan(
    proofData: ReadonlyUint8Array,
    verifyAction: (args: {
        rpc: Rpc<GetMinimumBalanceForRentExemptionApi>;
        payer: TransactionSigner;
        proofData: ProofDataInput;
        contextState: { contextAccount: Awaited<ReturnType<typeof generateKeyPairSigner>>; authority: Address };
    }) => Promise<Instruction[]>,
    payer: TransactionSigner,
    rpc: Rpc<GetMinimumBalanceForRentExemptionApi>,
    contextStateAuthority: TransactionSigner = payer,
    useRecordAccount = false,
): Promise<ContextStateProofPlan> {
    const contextAccount = await generateKeyPairSigner();
    const proofDataBytes = new Uint8Array(proofData);
    if (useRecordAccount) {
        const recordAuthority = await generateKeyPairSigner();
        const { recordKeypair, ixs: createRecordInstructions } = await createRecord({
            rpc,
            payer: payer as KeyPairSigner,
            authority: recordAuthority.address,
            dataLength: BigInt(proofDataBytes.length),
        });
        const verifyInstructions = await verifyAction({
            rpc,
            payer,
            proofData: {
                account: recordKeypair.address,
                offset: Number(RECORD_META_DATA_SIZE),
            },
            contextState: { contextAccount, authority: contextStateAuthority.address },
        });
        return {
            address: contextAccount.address,
            setup: sequentialInstructionPlan([
                ...createRecordInstructions,
                ...getRecordWriteInstructions(recordKeypair.address, recordAuthority, proofDataBytes),
                nonDivisibleSequentialInstructionPlan([
                    getSetComputeUnitLimitInstruction(MAX_COMPUTE_UNIT_LIMIT),
                    ...verifyInstructions,
                ]),
            ]),
            cleanup: sequentialInstructionPlan([
                closeContextStateProof({
                    contextState: contextAccount.address,
                    authority: contextStateAuthority,
                    destination: payer.address,
                }),
                createCloseRecordInstruction({
                    recordAccount: recordKeypair.address,
                    authority: recordAuthority,
                    receiver: payer.address,
                }),
            ]),
        };
    }

    const setupInstructions = await verifyAction({
        rpc,
        payer,
        proofData: proofDataBytes,
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
        cleanup: singleInstructionPlan(
            closeContextStateProof({
                contextState: contextAccount.address,
                authority: contextStateAuthority,
                destination: payer.address,
            }),
        ),
    };
}

/**
 * Returns a single-transaction plan that creates the ATA, reallocates it
 * for the confidential-transfer extension, configures the account, and
 * verifies the ZK pubkey-validity proof.
 *
 * Set `includeConfidentialTransferFeeAmount` when configuring accounts for
 * mints that also include confidential transfer fees.
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
                newExtensionTypes: input.includeConfidentialTransferFeeAmount
                    ? [ExtensionType.ConfidentialTransferAccount, ExtensionType.ConfidentialTransferFeeAmount]
                    : [ExtensionType.ConfidentialTransferAccount],
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
 * Builds an `ApplyPendingBalance` instruction plan from a decoded token
 * account, decrypting the pending balance and re-encrypting the new
 * available balance locally.
 */
export function getApplyConfidentialPendingBalanceInstructionFromToken(
    input: GetApplyConfidentialPendingBalanceInstructionFromTokenInput,
): Instruction {
    const account = getRequiredConfidentialTransferAccountExtension(input.tokenAccount);
    const pendingBalanceLo = input.elgamalSecretKey.decrypt(parseElGamalCiphertext(account.pendingBalanceLow));
    const pendingBalanceHi = input.elgamalSecretKey.decrypt(parseElGamalCiphertext(account.pendingBalanceHigh));
    const newDecryptableAvailableBalance = input.aesKey
        .encrypt(
            decryptAvailableBalance(account, input.aesKey) +
                combineAmounts(pendingBalanceLo, pendingBalanceHi, PENDING_BALANCE_LO_BIT_LENGTH),
        )
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
    const auditorPubkey = getAuditorElGamalPubkey(input);

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

/**
 * Returns an instruction plan that confidentially transfers tokens between
 * two accounts when the mint is configured for confidential transfer fees.
 * Builds and verifies the five proofs required by `TransferWithFee` via
 * context-state accounts.
 *
 * This helper requires the Pedersen arithmetic helpers added to
 * `@solana/zk-sdk` after v0.4.2.
 */
export async function getConfidentialTransferWithFeeInstructionPlan(
    input: GetConfidentialTransferWithFeeInstructionPlanInput,
): Promise<InstructionPlan> {
    const sourceAccount = getRequiredConfidentialTransferAccountExtension(input.sourceTokenAccount);
    const amount = BigInt(input.amount);
    assertNonNegativeAmount(amount);
    assertU64Amount(amount, 'Amount');

    const transferFeeConfig = getRequiredMintExtension(input.mintAccount, 'TransferFeeConfig');
    const confidentialTransferFee = getRequiredMintExtension(input.mintAccount, 'ConfidentialTransferFee');
    const transferFee = getEpochTransferFee(transferFeeConfig, input.currentEpoch);
    const maximumFee = BigInt(transferFee.maximumFee);
    const { feeAmount, claimedDeltaFee, netTransferAmount } = calculateTransferWithFeeAmounts(
        amount,
        transferFee.transferFeeBasisPoints,
        maximumFee,
    );

    assertU64Amount(feeAmount, 'Fee amount');
    assertU64Amount(claimedDeltaFee, 'Claimed delta fee');
    assertU64Amount(netTransferAmount, 'Net transfer amount');

    const [transferAmountLo, transferAmountHi] = splitAmount(amount, TRANSFER_AMOUNT_LO_BIT_LENGTH);
    const [feeAmountLo, feeAmountHi] = splitAmount(feeAmount, FEE_AMOUNT_LO_BIT_LENGTH);

    const sourcePubkey = input.sourceElgamalKeypair.pubkey();
    const destinationPubkey = getDestinationElGamalPubkey(input);
    const auditorPubkey = getAuditorElGamalPubkey(input);
    const withdrawWithheldAuthorityPubkey = getElGamalPubkeyFromAddress(confidentialTransferFee.elgamalPubkey);

    const transferAmountOpeningLo = new PedersenOpening();
    const transferAmountOpeningHi = new PedersenOpening();
    const transferAmountGroupedCiphertextLo = GroupedElGamalCiphertext3Handles.encryptWith(
        sourcePubkey,
        destinationPubkey,
        auditorPubkey,
        transferAmountLo,
        transferAmountOpeningLo,
    );
    const transferAmountGroupedCiphertextHi = GroupedElGamalCiphertext3Handles.encryptWith(
        sourcePubkey,
        destinationPubkey,
        auditorPubkey,
        transferAmountHi,
        transferAmountOpeningHi,
    );

    const transferAmountGroupedCiphertextLoBytes = transferAmountGroupedCiphertextLo.toBytes();
    const transferAmountGroupedCiphertextHiBytes = transferAmountGroupedCiphertextHi.toBytes();
    const transferAmountSourceCiphertextLo = extractCiphertextFromGroupedBytes(
        transferAmountGroupedCiphertextLoBytes,
        0,
    );
    const transferAmountSourceCiphertextHi = extractCiphertextFromGroupedBytes(
        transferAmountGroupedCiphertextHiBytes,
        0,
    );
    const transferAmountAuditorCiphertextLo = extractCiphertextFromGroupedBytes(
        transferAmountGroupedCiphertextLoBytes,
        2,
    );
    const transferAmountAuditorCiphertextHi = extractCiphertextFromGroupedBytes(
        transferAmountGroupedCiphertextHiBytes,
        2,
    );

    const currentAvailableBalance = decryptAvailableBalance(sourceAccount, input.aesKey);
    const newAvailableBalance = computeNewAvailableBalance(currentAvailableBalance, amount);
    assertU64Amount(newAvailableBalance, 'New available balance');

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
    const transferAmountCiphertextValidityProofData = new BatchedGroupedCiphertext3HandlesValidityProofData(
        sourcePubkey,
        destinationPubkey,
        auditorPubkey,
        transferAmountGroupedCiphertextLo,
        transferAmountGroupedCiphertextHi,
        transferAmountLo,
        transferAmountHi,
        transferAmountOpeningLo,
        transferAmountOpeningHi,
    );

    const transferAmountCommitmentLo = PedersenCommitment.fromBytes(
        transferAmountGroupedCiphertextLoBytes.slice(0, 32),
    );
    const transferAmountCommitmentHi = PedersenCommitment.fromBytes(
        transferAmountGroupedCiphertextHiBytes.slice(0, 32),
    );
    const combinedTransferAmountCommitment = combineLoHiCommitments(
        transferAmountCommitmentLo,
        transferAmountCommitmentHi,
        TRANSFER_AMOUNT_LO_BIT_LENGTH,
    );
    const combinedTransferAmountOpening = combineLoHiOpenings(
        transferAmountOpeningLo,
        transferAmountOpeningHi,
        TRANSFER_AMOUNT_LO_BIT_LENGTH,
    );

    const feeOpeningLo = new PedersenOpening();
    const feeOpeningHi = new PedersenOpening();
    const feeGroupedCiphertextLo = GroupedElGamalCiphertext2Handles.encryptWith(
        destinationPubkey,
        withdrawWithheldAuthorityPubkey,
        feeAmountLo,
        feeOpeningLo,
    );
    const feeGroupedCiphertextHi = GroupedElGamalCiphertext2Handles.encryptWith(
        destinationPubkey,
        withdrawWithheldAuthorityPubkey,
        feeAmountHi,
        feeOpeningHi,
    );
    const feeGroupedCiphertextLoBytes = feeGroupedCiphertextLo.toBytes();
    const feeGroupedCiphertextHiBytes = feeGroupedCiphertextHi.toBytes();
    const feeCommitmentLo = PedersenCommitment.fromBytes(feeGroupedCiphertextLoBytes.slice(0, 32));
    const feeCommitmentHi = PedersenCommitment.fromBytes(feeGroupedCiphertextHiBytes.slice(0, 32));
    const combinedFeeCommitment = combineLoHiCommitments(feeCommitmentLo, feeCommitmentHi, FEE_AMOUNT_LO_BIT_LENGTH);
    const combinedFeeOpening = combineLoHiOpenings(feeOpeningLo, feeOpeningHi, FEE_AMOUNT_LO_BIT_LENGTH);

    const netTransferAmountCommitment = subtractCommitments(combinedTransferAmountCommitment, combinedFeeCommitment);
    const netTransferAmountOpening = subtractOpenings(combinedTransferAmountOpening, combinedFeeOpening);
    const claimedOpening = new PedersenOpening();
    const claimedCommitment = PedersenCommitment.from(claimedDeltaFee, claimedOpening);
    const deltaCommitment = subtractCommitments(
        multiplyCommitment(combinedFeeCommitment, MAX_FEE_BASIS_POINTS),
        multiplyCommitment(combinedTransferAmountCommitment, BigInt(transferFee.transferFeeBasisPoints)),
    );
    const deltaOpening = subtractOpenings(
        multiplyOpening(combinedFeeOpening, MAX_FEE_BASIS_POINTS),
        multiplyOpening(combinedTransferAmountOpening, BigInt(transferFee.transferFeeBasisPoints)),
    );
    const percentageWithCapProofData = new PercentageWithCapProofData(
        combinedFeeCommitment,
        combinedFeeOpening,
        feeAmount,
        deltaCommitment,
        deltaOpening,
        claimedDeltaFee,
        claimedCommitment,
        claimedOpening,
        maximumFee,
    );
    const feeCiphertextValidityProofData = new BatchedGroupedCiphertext2HandlesValidityProofData(
        destinationPubkey,
        withdrawWithheldAuthorityPubkey,
        feeGroupedCiphertextLo,
        feeGroupedCiphertextHi,
        feeAmountLo,
        feeAmountHi,
        feeOpeningLo,
        feeOpeningHi,
    );

    const zeroOpening = getZeroOpening();
    const maxFeeBasisPointsSubOneCommitment = PedersenCommitment.from(MAX_FEE_BASIS_POINTS_SUB_ONE, zeroOpening);
    const claimedComplementCommitment = subtractCommitments(maxFeeBasisPointsSubOneCommitment, claimedCommitment);
    const claimedComplementOpening = subtractOpenings(zeroOpening, claimedOpening);
    const deltaFeeComplement = MAX_FEE_BASIS_POINTS_SUB_ONE - claimedDeltaFee;
    if (deltaFeeComplement < 0n) {
        throw new Error('Claimed delta fee exceeds maximum range.');
    }

    const rangeProofData = new BatchedRangeProofU256Data(
        [
            newAvailableBalanceCommitment,
            transferAmountCommitmentLo,
            transferAmountCommitmentHi,
            claimedCommitment,
            claimedComplementCommitment,
            feeCommitmentLo,
            feeCommitmentHi,
            netTransferAmountCommitment,
        ],
        new BigUint64Array([
            newAvailableBalance,
            transferAmountLo,
            transferAmountHi,
            claimedDeltaFee,
            deltaFeeComplement,
            feeAmountLo,
            feeAmountHi,
            netTransferAmount,
        ]),
        Uint8Array.from([
            REMAINING_BALANCE_BIT_LENGTH,
            Number(TRANSFER_AMOUNT_LO_BIT_LENGTH),
            Number(TRANSFER_AMOUNT_HI_BIT_LENGTH),
            DELTA_BIT_LENGTH,
            DELTA_BIT_LENGTH,
            Number(FEE_AMOUNT_LO_BIT_LENGTH),
            Number(FEE_AMOUNT_HI_BIT_LENGTH),
            NET_TRANSFER_AMOUNT_BIT_LENGTH,
        ]),
        [
            newAvailableBalanceOpening,
            transferAmountOpeningLo,
            transferAmountOpeningHi,
            claimedOpening,
            claimedComplementOpening,
            feeOpeningLo,
            feeOpeningHi,
            netTransferAmountOpening,
        ],
    );

    const [
        equalityProofPlan,
        transferAmountCiphertextValidityProofPlan,
        percentageWithCapProofPlan,
        feeCiphertextValidityProofPlan,
        rangeProofPlan,
    ] = await Promise.all([
        buildContextStateProofPlan(
            equalityProofData.toBytes(),
            verifyCiphertextCommitmentEquality,
            input.payer,
            input.rpc,
            input.payer,
            true,
        ),
        buildContextStateProofPlan(
            transferAmountCiphertextValidityProofData.toBytes(),
            verifyBatchedGroupedCiphertext3HandlesValidity,
            input.payer,
            input.rpc,
            input.payer,
            true,
        ),
        buildContextStateProofPlan(
            percentageWithCapProofData.toBytes(),
            verifyPercentageWithCap,
            input.payer,
            input.rpc,
            input.payer,
            true,
        ),
        buildContextStateProofPlan(
            feeCiphertextValidityProofData.toBytes(),
            verifyBatchedGroupedCiphertext2HandlesValidity,
            input.payer,
            input.rpc,
            input.payer,
            true,
        ),
        buildContextStateProofPlan(rangeProofData.toBytes(), verifyBatchedRangeProofU256, input.payer, input.rpc, input.payer, true),
    ]);

    return sequentialInstructionPlan([
        parallelInstructionPlan([
            equalityProofPlan.setup,
            transferAmountCiphertextValidityProofPlan.setup,
            percentageWithCapProofPlan.setup,
            feeCiphertextValidityProofPlan.setup,
            rangeProofPlan.setup,
        ]),
        getConfidentialTransferWithFeeInstruction(
            {
                sourceToken: input.sourceToken,
                mint: input.mint,
                destinationToken: input.destinationToken,
                equalityRecord: equalityProofPlan.address,
                transferAmountCiphertextValidityRecord: transferAmountCiphertextValidityProofPlan.address,
                feeSigmaRecord: percentageWithCapProofPlan.address,
                feeCiphertextValidityRecord: feeCiphertextValidityProofPlan.address,
                rangeRecord: rangeProofPlan.address,
                authority: input.authority,
                newSourceDecryptableAvailableBalance: input.aesKey.encrypt(newAvailableBalance).toBytes(),
                transferAmountAuditorCiphertextLo,
                transferAmountAuditorCiphertextHi,
                equalityProofInstructionOffset: 0,
                transferAmountCiphertextValidityProofInstructionOffset: 0,
                feeSigmaProofInstructionOffset: 0,
                feeCiphertextValidityProofInstructionOffset: 0,
                rangeProofInstructionOffset: 0,
                multiSigners: input.multiSigners,
            },
            { programAddress: input.programAddress ?? TOKEN_2022_PROGRAM_ADDRESS },
        ),
        parallelInstructionPlan([
            equalityProofPlan.cleanup,
            transferAmountCiphertextValidityProofPlan.cleanup,
            percentageWithCapProofPlan.cleanup,
            feeCiphertextValidityProofPlan.cleanup,
            rangeProofPlan.cleanup,
        ]),
    ]);
}
