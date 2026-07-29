import {
    RECORD_META_DATA_SIZE,
    getCloseAccountInstruction,
    getCreateRecordInstructionPlan,
    getWriteInstructionPlan,
} from '@solana-program/record';
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
    verifyZeroCiphertext,
} from '@solana-program/zk-elgamal-proof';
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
    type GetAccountInfoApi,
    type GetMinimumBalanceForRentExemptionApi,
    type FetchAccountConfig,
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
    ZeroCiphertextProofData,
} from '@solana/zk-sdk/bundler';

import {
    addWithLoHiCiphertexts,
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
    fetchMint,
    findAssociatedTokenPda,
    getApplyConfidentialPendingBalanceInstruction,
    getConfidentialBurnInstruction,
    getConfidentialMintInstruction,
    getConfidentialTransferInstruction,
    getConfidentialTransferWithFeeInstruction,
    getConfidentialWithdrawInstruction,
    getConfigureConfidentialTransferAccountInstruction,
    getCreateAssociatedTokenIdempotentInstruction,
    getEmptyConfidentialTransferAccountInstruction,
    getPermissionedConfidentialBurnInstruction,
    getReallocateInstruction,
    getUpdateConfidentialMintBurnDecryptableSupplyInstruction,
    fetchToken,
} from './generated';

const DEFAULT_MAXIMUM_PENDING_BALANCE_CREDIT_COUNTER = 1n << 16n;
const PENDING_BALANCE_LO_BIT_LENGTH = 16n;
const TRANSFER_AMOUNT_LO_BIT_LENGTH = 16n;
const TRANSFER_AMOUNT_HI_BIT_LENGTH = 32n;
const FEE_AMOUNT_LO_BIT_LENGTH = 16n;
const FEE_AMOUNT_HI_BIT_LENGTH = 32n;
const REMAINING_BALANCE_BIT_LENGTH = 64;
const RANGE_PROOF_PADDING_BIT_LENGTH = 16;
// A mint/burn amount is range-proven as a 16-bit low half + 32-bit high half, so
// it must fit in 48 bits (matching the Rust reference); a larger amount would
// otherwise silently produce a range proof the on-chain verifier rejects.
const MAX_MINT_BURN_AMOUNT = (1n << (TRANSFER_AMOUNT_LO_BIT_LENGTH + TRANSFER_AMOUNT_HI_BIT_LENGTH)) - 1n;
const MAX_FEE_BASIS_POINTS_SUB_ONE = 9_999n;
const MAX_FEE_BASIS_POINTS = 10_000n;
const DELTA_BIT_LENGTH = 16;
const NET_TRANSFER_AMOUNT_BIT_LENGTH = 64;
const COMPUTE_BUDGET_PROGRAM_ADDRESS =
    'ComputeBudget111111111111111111111111111111' as Address<'ComputeBudget111111111111111111111111111111'>;
const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;
const PEDERSEN_ARITHMETIC_ERROR =
    'Confidential transfer with fee requires @solana/zk-sdk Pedersen commitment and opening arithmetic.';

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

type ConfidentialTransferContextStateProofMode = {
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
    rpc: Rpc<GetMinimumBalanceForRentExemptionApi & GetAccountInfoApi>;
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
    /**
     * Decoded mint account used to resolve the configured auditor key when
     * `auditorElgamalPubkey` is omitted. Supplying this avoids an extra mint
     * fetch for callers that already have the mint account loaded.
     */
    mintAccount?: Mint;
    destinationToken: Address;
    sourceTokenAccount: Token;
    /**
     * Auditor ElGamal public key to use for the auditor ciphertexts. When
     * omitted, the helper resolves the key from `mintAccount`, then by fetching
     * the mint account. If the mint has no auditor configured, the zero auditor
     * key is used.
     */
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
    ConfidentialTransferContextStateProofMode;

type GetConfidentialTransferWithFeeInstructionPlanBaseInput = GetConfidentialTransferInstructionPlanBaseInput & {
    mintAccount: Mint;
    currentEpoch: number | bigint;
};

type RecordBackedContextStateProofMode = Omit<ConfidentialTransferContextStateProofMode, 'payer'> & {
    payer: KeyPairSigner;
};

export type GetConfidentialTransferWithFeeInstructionPlanInput =
    GetConfidentialTransferWithFeeInstructionPlanBaseInput & RecordBackedContextStateProofMode;

/** Fields shared by the confidential mint and burn instruction plan inputs. */
type GetConfidentialMintBurnInstructionPlanBaseInput = {
    /** The token account the amount is minted into or burnt from. */
    token: Address;
    mint: Address;
    /** Decoded mint account, read for the `ConfidentialMintBurn` supply state and auditor key. */
    mintAccount: Mint;
    authority: Address | TransactionSigner;
    amount: number | bigint;
    /**
     * Auditor ElGamal public key to use for the auditor ciphertexts. When
     * omitted, the helper resolves the key from `mintAccount`'s
     * `ConfidentialTransferMint` extension. If the mint has no auditor
     * configured, the zero auditor key is used.
     */
    auditorElgamalPubkey?: Address;
    multiSigners?: Array<TransactionSigner>;
    programAddress?: Address;
};

type GetConfidentialMintInstructionPlanBaseInput = GetConfidentialMintBurnInstructionPlanBaseInput & {
    /** Decoded destination token account, read for its ElGamal public key. */
    destinationTokenAccount: Token;
    /** The supply ElGamal keypair (backs the equality proof; encrypts the new supply). */
    supplyElgamalKeypair: ElGamalKeypair;
    /** The supply AES key (decrypts the current supply and encrypts the new decryptable supply). */
    supplyAesKey: AeKey;
};

export type GetConfidentialMintInstructionPlanInput = GetConfidentialMintInstructionPlanBaseInput &
    ConfidentialTransferContextStateProofMode;

type GetConfidentialBurnInstructionPlanBaseInput = GetConfidentialMintBurnInstructionPlanBaseInput & {
    /** Decoded source token account, read for its available-balance ciphertext and ElGamal public key. */
    sourceTokenAccount: Token;
    /** The source account's ElGamal keypair (backs the equality proof). */
    sourceElgamalKeypair: ElGamalKeypair;
    /** The source account's AES key (decrypts and re-encrypts the available balance). */
    aesKey: AeKey;
};

export type GetConfidentialBurnInstructionPlanInput = GetConfidentialBurnInstructionPlanBaseInput &
    ConfidentialTransferContextStateProofMode;

export type GetPermissionedConfidentialBurnInstructionPlanInput = GetConfidentialBurnInstructionPlanInput & {
    /**
     * The authority configured on the mint's `PermissionedBurn` extension. It
     * must sign every permissioned burn; the token-2022 program rejects the
     * standard burn variant when this extension is present.
     */
    permissionedBurnAuthority: TransactionSigner;
};

export type GetUpdateConfidentialMintBurnDecryptableSupplyInstructionFromSupplyInput = {
    mint: Address;
    authority: Address | TransactionSigner;
    /** The supply AES key that encrypts the decryptable supply. */
    supplyAesKey: AeKey;
    /** The true current supply to encode into the decryptable supply. */
    supply: number | bigint;
    multiSigners?: Array<TransactionSigner>;
    programAddress?: Address;
};

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

/**
 * Resolves the auditor ElGamal public key for any confidential instruction that
 * carries auditor ciphertexts (transfer, transfer-with-fee, mint and burn): from
 * an explicit override, else from the mint's `ConfidentialTransferMint`
 * extension, fetching the mint only when the caller did not supply it. Falls
 * back to the zero auditor key when the mint configures no auditor.
 */
async function getAuditorElGamalPubkey(input: {
    auditorElgamalPubkey?: Address;
    mintAccount?: Mint;
    mint: Address;
    rpc: Rpc<GetMinimumBalanceForRentExemptionApi & GetAccountInfoApi>;
}) {
    if (input.auditorElgamalPubkey) {
        return getElGamalPubkeyFromAddress(input.auditorElgamalPubkey);
    }

    const mint = input.mintAccount ?? (await fetchMint(input.rpc, input.mint)).data;
    const extension = getRequiredMintExtension(mint, 'ConfidentialTransferMint');
    return isSome(extension.auditorElgamalPubkey)
        ? getElGamalPubkeyFromAddress(extension.auditorElgamalPubkey.value)
        : getDefaultAuditorElGamalPubkey();
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

function assertNonNegativeAmount(amount: bigint): void {
    if (amount < 0n) {
        throw new Error('Amount must be non-negative.');
    }
}

function assertU64Amount(amount: bigint, name: string): void {
    if (amount < 0n) {
        throw new Error(`${name} must be non-negative.`);
    }
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

function assertPedersenArithmeticAvailable(): void {
    const commitmentConstructor = PedersenCommitment as unknown as PedersenCommitmentConstructorWithArithmetic;
    const openingConstructor = PedersenOpening as unknown as PedersenOpeningConstructorWithArithmetic;
    const commitment = PedersenCommitment.from(0n, new PedersenOpening()) as PedersenCommitmentWithArithmetic;
    const opening = new PedersenOpening() as PedersenOpeningWithArithmetic;
    if (
        typeof commitmentConstructor.combineLoHi !== 'function' ||
        typeof openingConstructor.combineLoHi !== 'function' ||
        typeof openingConstructor.zero !== 'function' ||
        typeof commitment.subtract !== 'function' ||
        typeof commitment.multiplyByU64 !== 'function' ||
        typeof opening.subtract !== 'function' ||
        typeof opening.multiplyByU64 !== 'function'
    ) {
        throw new Error(PEDERSEN_ARITHMETIC_ERROR);
    }
}

function combineLoHiCommitments(lo: PedersenCommitment, hi: PedersenCommitment, bitLength: bigint): PedersenCommitment {
    const PedersenCommitmentWithArithmetic =
        PedersenCommitment as unknown as PedersenCommitmentConstructorWithArithmetic;
    return PedersenCommitmentWithArithmetic.combineLoHi(lo, hi, Number(bitLength));
}

function combineLoHiOpenings(lo: PedersenOpening, hi: PedersenOpening, bitLength: bigint): PedersenOpening {
    const PedersenOpeningWithArithmetic = PedersenOpening as unknown as PedersenOpeningConstructorWithArithmetic;
    return PedersenOpeningWithArithmetic.combineLoHi(lo, hi, Number(bitLength));
}

function getZeroOpening(): PedersenOpening {
    const PedersenOpeningWithArithmetic = PedersenOpening as unknown as PedersenOpeningConstructorWithArithmetic;
    return PedersenOpeningWithArithmetic.zero();
}

function subtractCommitments(left: PedersenCommitment, right: PedersenCommitment): PedersenCommitment {
    const leftWithArithmetic = left as PedersenCommitmentWithArithmetic;
    return leftWithArithmetic.subtract(right);
}

function subtractOpenings(left: PedersenOpening, right: PedersenOpening): PedersenOpening {
    const leftWithArithmetic = left as PedersenOpeningWithArithmetic;
    return leftWithArithmetic.subtract(right);
}

function multiplyCommitment(commitment: PedersenCommitment, scalar: bigint): PedersenCommitment {
    const commitmentWithArithmetic = commitment as PedersenCommitmentWithArithmetic;
    return commitmentWithArithmetic.multiplyByU64(scalar);
}

function multiplyOpening(opening: PedersenOpening, scalar: bigint): PedersenOpening {
    const openingWithArithmetic = opening as PedersenOpeningWithArithmetic;
    return openingWithArithmetic.multiplyByU64(scalar);
}

function getSetComputeUnitLimitInstruction(units: number): Instruction {
    const data = new Uint8Array(5);
    data[0] = 2;
    new DataView(data.buffer).setUint32(1, units, true);
    return { programAddress: COMPUTE_BUDGET_PROGRAM_ADDRESS, data };
}

/**
 * Builds the setup-and-cleanup instruction plans for a single proof's
 * context-state account. The setup plan creates the context-state account
 * and verifies the proof into it (these two instructions must share a
 * transaction). The cleanup plan closes the context-state account to recover
 * its rent.
 */
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
    recordPayer?: KeyPairSigner,
): Promise<ContextStateProofPlan> {
    const contextAccount = await generateKeyPairSigner();
    const proofDataBytes = new Uint8Array(proofData);
    if (recordPayer) {
        const recordAuthority = await generateKeyPairSigner();
        const recordKeypair = await generateKeyPairSigner();
        const recordClient = {
            getMinimumBalance: (space: number) => rpc.getMinimumBalanceForRentExemption(BigInt(space)).send(),
        };
        const createRecordPlan = await getCreateRecordInstructionPlan(recordClient, {
            payer: recordPayer,
            newRecord: recordKeypair,
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
                createRecordPlan,
                getWriteInstructionPlan({
                    recordAccount: recordKeypair.address,
                    authority: recordAuthority,
                    data: proofDataBytes,
                }),
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
                getCloseAccountInstruction({
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
    const auditorPubkey = await getAuditorElGamalPubkey(input);

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
    assertPedersenArithmeticAvailable();

    const [transferAmountLo, transferAmountHi] = splitAmount(amount, TRANSFER_AMOUNT_LO_BIT_LENGTH);
    const [feeAmountLo, feeAmountHi] = splitAmount(feeAmount, FEE_AMOUNT_LO_BIT_LENGTH);

    const sourcePubkey = input.sourceElgamalKeypair.pubkey();
    const destinationPubkey = getDestinationElGamalPubkey(input);
    const auditorPubkey = await getAuditorElGamalPubkey(input);
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
        ),
        buildContextStateProofPlan(
            transferAmountCiphertextValidityProofData.toBytes(),
            verifyBatchedGroupedCiphertext3HandlesValidity,
            input.payer,
            input.rpc,
        ),
        buildContextStateProofPlan(
            percentageWithCapProofData.toBytes(),
            verifyPercentageWithCap,
            input.payer,
            input.rpc,
        ),
        buildContextStateProofPlan(
            feeCiphertextValidityProofData.toBytes(),
            verifyBatchedGroupedCiphertext2HandlesValidity,
            input.payer,
            input.rpc,
        ),
        buildContextStateProofPlan(
            rangeProofData.toBytes(),
            verifyBatchedRangeProofU256,
            input.payer,
            input.rpc,
            input.payer,
            input.payer,
        ),
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

function assertMintBurnAmount(amount: bigint, label: 'Mint' | 'Burn'): void {
    if (amount <= 0n) {
        throw new Error(`${label} amount must be positive.`);
    }
    if (amount > MAX_MINT_BURN_AMOUNT) {
        throw new Error(
            `${label} amount exceeds the maximum confidential mint/burn amount (2^48 - 1 = ${MAX_MINT_BURN_AMOUNT}).`,
        );
    }
}

/**
 * Returns an instruction plan that confidentially mints `amount` tokens into a
 * token account's pending balance, encrypting the amount on-chain and advancing
 * the mint's encrypted supply. Splits the amount into lo/hi halves and verifies
 * the three required proofs (equality, grouped-ciphertext validity, batched
 * range) via context-state accounts.
 *
 * The amount is grouped-encrypted under `[destination, supply, auditor]`; the
 * supply handle (index 1) is homomorphically added to the mint's current supply
 * ciphertext, and the auditor handle (index 2) is carried by the instruction.
 *
 * **The mint's two supply representations must be in sync.** The equality proof
 * asserts that the mint's `confidentialSupply` ElGamal ciphertext plus `amount`
 * equals `AES_decrypt(decryptableSupply) + amount`. If the two have drifted —
 * e.g. after `ApplyPendingBurn`, which advances the ElGamal supply but cannot
 * re-encrypt the AES form — the proof is rejected on-chain. Re-sync first with
 * {@link getUpdateConfidentialMintBurnDecryptableSupplyInstructionFromSupply}.
 */
export async function getConfidentialMintInstructionPlan(
    input: GetConfidentialMintInstructionPlanInput,
): Promise<InstructionPlan> {
    const mintBurnExtension = getRequiredMintExtension(input.mintAccount, 'ConfidentialMintBurn');
    const amount = BigInt(input.amount);
    assertMintBurnAmount(amount, 'Mint');

    const currentSupply = input.supplyAesKey.decrypt(parseAeCiphertext(mintBurnExtension.decryptableSupply));
    const newSupply = currentSupply + amount;
    assertU64Amount(newSupply, 'New supply after mint');

    const [amountLo, amountHi] = splitAmount(amount, TRANSFER_AMOUNT_LO_BIT_LENGTH);
    const destinationPubkey = getElGamalPubkeyFromAddress(
        getRequiredConfidentialTransferAccountExtension(input.destinationTokenAccount).elgamalPubkey,
    );
    const supplyPubkey = input.supplyElgamalKeypair.pubkey();
    const auditorPubkey = await getAuditorElGamalPubkey(input);

    const openingLo = new PedersenOpening();
    const openingHi = new PedersenOpening();
    // Grouped handle order for MINT: [destination, supply, auditor].
    const groupedCiphertextLo = GroupedElGamalCiphertext3Handles.encryptWith(
        destinationPubkey,
        supplyPubkey,
        auditorPubkey,
        amountLo,
        openingLo,
    );
    const groupedCiphertextHi = GroupedElGamalCiphertext3Handles.encryptWith(
        destinationPubkey,
        supplyPubkey,
        auditorPubkey,
        amountHi,
        openingHi,
    );

    const groupedCiphertextLoBytes = groupedCiphertextLo.toBytes();
    const groupedCiphertextHiBytes = groupedCiphertextHi.toBytes();
    // New supply ciphertext = current supply + combine_lo_hi(supply handle, index 1).
    const supplyCiphertextLo = extractCiphertextFromGroupedBytes(groupedCiphertextLoBytes, 1);
    const supplyCiphertextHi = extractCiphertextFromGroupedBytes(groupedCiphertextHiBytes, 1);
    const mintAmountAuditorCiphertextLo = extractCiphertextFromGroupedBytes(groupedCiphertextLoBytes, 2);
    const mintAmountAuditorCiphertextHi = extractCiphertextFromGroupedBytes(groupedCiphertextHiBytes, 2);

    const newSupplyCiphertext = parseElGamalCiphertext(
        addWithLoHiCiphertexts(
            mintBurnExtension.confidentialSupply,
            supplyCiphertextLo,
            supplyCiphertextHi,
            TRANSFER_AMOUNT_LO_BIT_LENGTH,
        ),
    );

    const newSupplyOpening = new PedersenOpening();
    const newSupplyCommitment = PedersenCommitment.from(newSupply, newSupplyOpening);

    const equalityProofData = new CiphertextCommitmentEqualityProofData(
        input.supplyElgamalKeypair,
        newSupplyCiphertext,
        newSupplyCommitment,
        newSupplyOpening,
        newSupply,
    );
    const ciphertextValidityProofData = new BatchedGroupedCiphertext3HandlesValidityProofData(
        destinationPubkey,
        supplyPubkey,
        auditorPubkey,
        groupedCiphertextLo,
        groupedCiphertextHi,
        amountLo,
        amountHi,
        openingLo,
        openingHi,
    );

    const commitmentLo = PedersenCommitment.fromBytes(groupedCiphertextLoBytes.slice(0, 32));
    const commitmentHi = PedersenCommitment.fromBytes(groupedCiphertextHiBytes.slice(0, 32));
    const paddingOpening = new PedersenOpening();
    const paddingCommitment = PedersenCommitment.from(0n, paddingOpening);
    const rangeProofData = new BatchedRangeProofU128Data(
        [newSupplyCommitment, commitmentLo, commitmentHi, paddingCommitment],
        new BigUint64Array([newSupply, amountLo, amountHi, 0n]),
        Uint8Array.from([
            REMAINING_BALANCE_BIT_LENGTH,
            Number(TRANSFER_AMOUNT_LO_BIT_LENGTH),
            Number(TRANSFER_AMOUNT_HI_BIT_LENGTH),
            RANGE_PROOF_PADDING_BIT_LENGTH,
        ]),
        [newSupplyOpening, openingLo, openingHi, paddingOpening],
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
        getConfidentialMintInstruction(
            {
                token: input.token,
                mint: input.mint,
                equalityRecord: equalityProofPlan.address,
                ciphertextValidityRecord: ciphertextValidityProofPlan.address,
                rangeRecord: rangeProofPlan.address,
                authority: input.authority,
                newDecryptableSupply: input.supplyAesKey.encrypt(newSupply).toBytes(),
                mintAmountAuditorCiphertextLo,
                mintAmountAuditorCiphertextHi,
                equalityProofInstructionOffset: 0,
                ciphertextValidityProofInstructionOffset: 0,
                rangeProofInstructionOffset: 0,
                multiSigners: input.multiSigners,
            },
            { programAddress: getTokenProgramAddress(input.programAddress) },
        ),
        parallelInstructionPlan([
            equalityProofPlan.cleanup,
            ciphertextValidityProofPlan.cleanup,
            rangeProofPlan.cleanup,
        ]),
    ]);
}

/**
 * Computes the three burn proofs (equality, grouped-ciphertext validity, U128
 * range), builds their context-state setup/cleanup plans, and assembles the
 * burn-instruction arguments shared by both the standard and permissioned burn
 * variants. Shared by {@link getConfidentialBurnInstructionPlan} and
 * {@link getPermissionedConfidentialBurnInstructionPlan} — the two differ only
 * in which middle instruction they emit and its signer set, not in the proofs.
 *
 * The amount is grouped-encrypted under `[source, supply, auditor]`; the source
 * handle (index 0) is homomorphically subtracted from the account's available
 * balance, and the auditor handle (index 2) is carried by the instruction.
 */
async function buildConfidentialBurnProofPlan(input: GetConfidentialBurnInstructionPlanInput) {
    const sourceAccount = getRequiredConfidentialTransferAccountExtension(input.sourceTokenAccount);
    const mintBurnExtension = getRequiredMintExtension(input.mintAccount, 'ConfidentialMintBurn');
    const amount = BigInt(input.amount);
    assertMintBurnAmount(amount, 'Burn');

    const currentAvailableBalance = decryptAvailableBalance(sourceAccount, input.aesKey);
    const remainingBalance = computeNewAvailableBalance(currentAvailableBalance, amount);

    const [amountLo, amountHi] = splitAmount(amount, TRANSFER_AMOUNT_LO_BIT_LENGTH);
    const sourcePubkey = input.sourceElgamalKeypair.pubkey();
    const supplyPubkey = getElGamalPubkeyFromAddress(mintBurnExtension.supplyElgamalPubkey);
    const auditorPubkey = await getAuditorElGamalPubkey(input);

    const openingLo = new PedersenOpening();
    const openingHi = new PedersenOpening();
    // Grouped handle order for BURN: [source, supply, auditor].
    const groupedCiphertextLo = GroupedElGamalCiphertext3Handles.encryptWith(
        sourcePubkey,
        supplyPubkey,
        auditorPubkey,
        amountLo,
        openingLo,
    );
    const groupedCiphertextHi = GroupedElGamalCiphertext3Handles.encryptWith(
        sourcePubkey,
        supplyPubkey,
        auditorPubkey,
        amountHi,
        openingHi,
    );

    const groupedCiphertextLoBytes = groupedCiphertextLo.toBytes();
    const groupedCiphertextHiBytes = groupedCiphertextHi.toBytes();
    // New available balance ciphertext = current balance − combine_lo_hi(source handle, index 0).
    const sourceCiphertextLo = extractCiphertextFromGroupedBytes(groupedCiphertextLoBytes, 0);
    const sourceCiphertextHi = extractCiphertextFromGroupedBytes(groupedCiphertextHiBytes, 0);
    const burnAmountAuditorCiphertextLo = extractCiphertextFromGroupedBytes(groupedCiphertextLoBytes, 2);
    const burnAmountAuditorCiphertextHi = extractCiphertextFromGroupedBytes(groupedCiphertextHiBytes, 2);

    const newAvailableBalanceCiphertext = parseElGamalCiphertext(
        subtractWithLoHiCiphertexts(
            sourceAccount.availableBalance,
            sourceCiphertextLo,
            sourceCiphertextHi,
            TRANSFER_AMOUNT_LO_BIT_LENGTH,
        ),
    );

    const newAvailableBalanceOpening = new PedersenOpening();
    const newAvailableBalanceCommitment = PedersenCommitment.from(remainingBalance, newAvailableBalanceOpening);

    const equalityProofData = new CiphertextCommitmentEqualityProofData(
        input.sourceElgamalKeypair,
        newAvailableBalanceCiphertext,
        newAvailableBalanceCommitment,
        newAvailableBalanceOpening,
        remainingBalance,
    );
    const ciphertextValidityProofData = new BatchedGroupedCiphertext3HandlesValidityProofData(
        sourcePubkey,
        supplyPubkey,
        auditorPubkey,
        groupedCiphertextLo,
        groupedCiphertextHi,
        amountLo,
        amountHi,
        openingLo,
        openingHi,
    );

    const commitmentLo = PedersenCommitment.fromBytes(groupedCiphertextLoBytes.slice(0, 32));
    const commitmentHi = PedersenCommitment.fromBytes(groupedCiphertextHiBytes.slice(0, 32));
    const paddingOpening = new PedersenOpening();
    const paddingCommitment = PedersenCommitment.from(0n, paddingOpening);
    const rangeProofData = new BatchedRangeProofU128Data(
        [newAvailableBalanceCommitment, commitmentLo, commitmentHi, paddingCommitment],
        new BigUint64Array([remainingBalance, amountLo, amountHi, 0n]),
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

    return {
        setup: parallelInstructionPlan([
            equalityProofPlan.setup,
            ciphertextValidityProofPlan.setup,
            rangeProofPlan.setup,
        ]),
        cleanup: parallelInstructionPlan([
            equalityProofPlan.cleanup,
            ciphertextValidityProofPlan.cleanup,
            rangeProofPlan.cleanup,
        ]),
        // Arguments common to both burn instruction variants. The account owner
        // (`authority`) always signs; the variant-specific signer field
        // (`multiSigners` / `permissionedBurnAuthority`) is added by the caller.
        burnArgs: {
            token: input.token,
            mint: input.mint,
            equalityRecord: equalityProofPlan.address,
            ciphertextValidityRecord: ciphertextValidityProofPlan.address,
            rangeRecord: rangeProofPlan.address,
            authority: input.authority,
            newDecryptableAvailableBalance: input.aesKey.encrypt(remainingBalance).toBytes(),
            burnAmountAuditorCiphertextLo,
            burnAmountAuditorCiphertextHi,
            equalityProofInstructionOffset: 0,
            ciphertextValidityProofInstructionOffset: 0,
            rangeProofInstructionOffset: 0,
        },
    };
}

/**
 * Returns an instruction plan that confidentially burns `amount` tokens from a
 * token account's available balance, encrypting the amount on-chain and
 * advancing the mint's encrypted pending burn. Symmetric to
 * `getConfidentialMintInstructionPlan`.
 *
 * Emits the **standard** `ConfidentialBurn` instruction. For mints carrying the
 * `PermissionedBurn` extension the token-2022 program rejects this variant — use
 * {@link getPermissionedConfidentialBurnInstructionPlan} instead.
 */
export async function getConfidentialBurnInstructionPlan(
    input: GetConfidentialBurnInstructionPlanInput,
): Promise<InstructionPlan> {
    const { setup, cleanup, burnArgs } = await buildConfidentialBurnProofPlan(input);
    return sequentialInstructionPlan([
        setup,
        getConfidentialBurnInstruction(
            { ...burnArgs, multiSigners: input.multiSigners },
            { programAddress: getTokenProgramAddress(input.programAddress) },
        ),
        cleanup,
    ]);
}

/**
 * Like {@link getConfidentialBurnInstructionPlan}, but emits the **permissioned**
 * burn variant, which token-2022 requires for mints carrying the
 * `PermissionedBurn` extension (it rejects the standard variant on such mints
 * with `TokenError::InvalidInstruction`). Identical proofs; the only difference
 * is the mint's configured `permissionedBurnAuthority` co-signs alongside the
 * account owner (`authority`).
 */
export async function getPermissionedConfidentialBurnInstructionPlan(
    input: GetPermissionedConfidentialBurnInstructionPlanInput,
): Promise<InstructionPlan> {
    const { setup, cleanup, burnArgs } = await buildConfidentialBurnProofPlan(input);
    return sequentialInstructionPlan([
        setup,
        getPermissionedConfidentialBurnInstruction(
            {
                ...burnArgs,
                multiSigners: input.multiSigners,
                permissionedBurnAuthority: input.permissionedBurnAuthority,
            },
            { programAddress: getTokenProgramAddress(input.programAddress) },
        ),
        cleanup,
    ]);
}

/**
 * Re-encrypts and updates the mint's decryptable supply to `supply` under the
 * supply AES key. Signed by the mint authority. No proof required — returns a
 * single instruction.
 *
 * The confidential supply is maintained on-chain both as an ElGamal ciphertext
 * (updated homomorphically by mint/burn) and as a cheap-to-decrypt AES
 * "decryptable supply". The two can drift — e.g. `ApplyPendingBurn` advances the
 * ElGamal supply but cannot re-encrypt the AES form — so the authority uses this
 * to re-assert the decryptable supply to the true supply it tracks.
 */
export function getUpdateConfidentialMintBurnDecryptableSupplyInstructionFromSupply(
    input: GetUpdateConfidentialMintBurnDecryptableSupplyInstructionFromSupplyInput,
): Instruction {
    const supply = BigInt(input.supply);
    // Supply is a u64 on-chain; reject out-of-range values before handing them
    // to the WASM AES encrypt (which would otherwise fail opaquely or wrap).
    assertU64Amount(supply, 'Supply');

    return getUpdateConfidentialMintBurnDecryptableSupplyInstruction(
        {
            mint: input.mint,
            authority: input.authority,
            newDecryptableSupply: input.supplyAesKey.encrypt(supply).toBytes(),
            multiSigners: input.multiSigners,
        },
        { programAddress: getTokenProgramAddress(input.programAddress) },
    );
}
