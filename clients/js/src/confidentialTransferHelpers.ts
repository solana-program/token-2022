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
    getConfidentialTransferInstruction,
    getConfidentialTransferWithFeeInstruction,
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
const FEE_AMOUNT_LO_BIT_LENGTH = 16n;
const FEE_AMOUNT_HI_BIT_LENGTH = 32n;
const REMAINING_BALANCE_BIT_LENGTH = 64;
const RANGE_PROOF_PADDING_BIT_LENGTH = 16;
const MAX_FEE_BASIS_POINTS_SUB_ONE = 9_999n;
const MAX_FEE_BASIS_POINTS = 10_000n;
const DELTA_BIT_LENGTH = 16;
const NET_TRANSFER_AMOUNT_BIT_LENGTH = 64;
type ConfidentialTransferAccountExtension = Extract<Extension, { __kind: 'ConfidentialTransferAccount' }>;
type ConfidentialTransferMintExtension = Extract<Extension, { __kind: 'ConfidentialTransferMint' }>;
type TransferFeeConfigExtension = Extract<Extension, { __kind: 'TransferFeeConfig' }>;
type TransferFee = TransferFeeConfigExtension['olderTransferFee'];
type ProofDataInput = Uint8Array | { account: Address; offset: number };
type ContextStateProofPlan = Readonly<{ address: Address; setup: InstructionPlan; cleanup: InstructionPlan }>;

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

export type GetConfidentialWithdrawInstructionPlanInput = {
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
    payer: TransactionSigner;
    rpc: Rpc<GetMinimumBalanceForRentExemptionApi>;
};

/** Input for {@link getConfidentialWithdrawWithRecordInstructionPlan}. */
export type GetConfidentialWithdrawWithRecordInstructionPlanInput = GetConfidentialWithdrawInstructionPlanInput & {
    /** Funds the record account that stages the range proof. Defaults to `payer`. */
    recordPayer?: TransactionSigner;
    /** Signs the record account's write and close. Defaults to an ephemeral signer. */
    recordAuthority?: TransactionSigner;
    /** Receives the record account's reclaimed rent on close. Defaults to the record payer. */
    recordRentReceiver?: Address;
};

export type GetEmptyConfidentialTransferAccountInstructionPlanInput = {
    token: Address;
    tokenAccount: Token;
    authority: Address | TransactionSigner;
    elgamalKeypair: ElGamalKeypair;
    multiSigners?: Array<TransactionSigner>;
    programAddress?: Address;
    payer: TransactionSigner;
    rpc: Rpc<GetMinimumBalanceForRentExemptionApi>;
};

export type GetConfidentialTransferInstructionPlanInput = {
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
    payer: TransactionSigner;
    // The transfer helpers may need to read the mint account to resolve the
    // auditor ElGamal key, so the RPC must support account reads as well.
    rpc: Rpc<GetMinimumBalanceForRentExemptionApi & GetAccountInfoApi>;
} & (
    | { destinationTokenAccount: Token; destinationElgamalPubkey?: Address }
    | { destinationElgamalPubkey: Address; destinationTokenAccount?: never }
);

/** Input for {@link getConfidentialTransferWithRecordInstructionPlan}. */
export type GetConfidentialTransferWithRecordInstructionPlanInput = GetConfidentialTransferInstructionPlanInput & {
    /** Funds the record account that stages the range proof. Defaults to `payer`. */
    recordPayer?: TransactionSigner;
    /** Signs the record account's write and close. Defaults to an ephemeral signer. */
    recordAuthority?: TransactionSigner;
    /** Receives the record account's reclaimed rent on close. Defaults to the record payer. */
    recordRentReceiver?: Address;
};

export type GetConfidentialTransferWithFeeInstructionPlanInput = GetConfidentialTransferInstructionPlanInput & {
    mintAccount: Mint;
    currentEpoch: number | bigint;
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

function getRequiredConfidentialTransferMintExtension(mint: Mint): ConfidentialTransferMintExtension {
    if (!isSome(mint.extensions)) {
        throw new Error('Mint account is missing extensions.');
    }

    const extension = mint.extensions.value.find(candidate => candidate.__kind === 'ConfidentialTransferMint') as
        | ConfidentialTransferMintExtension
        | undefined;
    if (!extension) {
        throw new Error('Mint account is missing the ConfidentialTransferMint extension.');
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

async function getAuditorElGamalPubkey(input: GetConfidentialTransferInstructionPlanInput) {
    if (input.auditorElgamalPubkey) {
        return getElGamalPubkeyFromAddress(input.auditorElgamalPubkey);
    }

    const mint = input.mintAccount ?? (await fetchMint(input.rpc, input.mint)).data;
    const extension = getRequiredConfidentialTransferMintExtension(mint);
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

/**
 * Builds the setup-and-cleanup instruction plans for a single proof's
 * context-state account. The setup plan creates the context-state account
 * and verifies the proof into it (these two instructions must share a
 * transaction). The cleanup plan closes the context-state account to recover
 * its rent.
 *
 * When `recordPayer` is provided, the proof is staged in an SPL Record account
 * (created, written and closed by the setup/cleanup plans) rather than passed
 * inline in the verify instruction data. `recordAuthority` signs the record's
 * write and close (defaulting to an ephemeral generated signer), and the
 * record's reclaimed rent is sent to `recordRentReceiver` (defaulting to the
 * record payer, so whoever funded the account is reimbursed).
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
    recordPayer?: TransactionSigner,
    recordAuthority?: TransactionSigner,
    recordRentReceiver?: Address,
): Promise<ContextStateProofPlan> {
    const contextAccount = await generateKeyPairSigner();
    const proofDataBytes = new Uint8Array(proofData);
    if (recordPayer) {
        const resolvedRecordAuthority = recordAuthority ?? (await generateKeyPairSigner());
        const resolvedRecordRentReceiver = recordRentReceiver ?? recordPayer.address;
        const recordKeypair = await generateKeyPairSigner();
        const recordClient = {
            getMinimumBalance: (space: number) => rpc.getMinimumBalanceForRentExemption(BigInt(space)).send(),
        };
        const createRecordPlan = await getCreateRecordInstructionPlan(recordClient, {
            payer: recordPayer,
            newRecord: recordKeypair,
            authority: resolvedRecordAuthority.address,
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
                    authority: resolvedRecordAuthority,
                    data: proofDataBytes,
                }),
                nonDivisibleSequentialInstructionPlan(verifyInstructions),
            ]),
            cleanup: sequentialInstructionPlan([
                closeContextStateProof({
                    contextState: contextAccount.address,
                    authority: contextStateAuthority,
                    destination: payer.address,
                }),
                getCloseAccountInstruction({
                    recordAccount: recordKeypair.address,
                    authority: resolvedRecordAuthority,
                    receiver: resolvedRecordRentReceiver,
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

// The proof data and instruction fields for a confidential withdraw, derived
// from the input independently of how each proof is delivered on-chain.
type ConfidentialWithdrawProofData = {
    equalityProofData: CiphertextCommitmentEqualityProofData;
    rangeProofData: BatchedRangeProofU64Data;
    newAvailableBalance: bigint;
};

function buildConfidentialWithdrawProofData(
    input: GetConfidentialWithdrawInstructionPlanInput,
): ConfidentialWithdrawProofData {
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

    return { equalityProofData, rangeProofData, newAvailableBalance };
}

function assembleConfidentialWithdrawPlan(
    input: GetConfidentialWithdrawInstructionPlanInput,
    proofData: ConfidentialWithdrawProofData,
    proofPlans: { equalityProofPlan: ContextStateProofPlan; rangeProofPlan: ContextStateProofPlan },
): InstructionPlan {
    const { equalityProofPlan, rangeProofPlan } = proofPlans;
    return sequentialInstructionPlan([
        parallelInstructionPlan([equalityProofPlan.setup, rangeProofPlan.setup]),
        getConfidentialWithdrawInstruction(
            {
                token: input.token,
                mint: input.mint,
                equalityRecord: equalityProofPlan.address,
                rangeRecord: rangeProofPlan.address,
                authority: input.authority,
                amount: BigInt(input.amount),
                decimals: input.decimals,
                newDecryptableAvailableBalance: input.aesKey.encrypt(proofData.newAvailableBalance).toBytes(),
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
 * Returns an instruction plan that moves tokens from the encrypted
 * available balance back to the plaintext balance. Generates and verifies
 * the equality and batched range proofs via context-state accounts.
 *
 * The range proof is provided inline in the verify instruction data. This keeps
 * the flow to a minimal number of transactions, but the range-proof transaction
 * sits close to the transaction size limit and cannot accommodate an extra
 * compute-unit-limit instruction. Callers that send with a transaction plan
 * executor which sets compute-unit limits (e.g. by simulating) should either
 * disable that estimation or use {@link getConfidentialWithdrawWithRecordInstructionPlan},
 * which stages the range proof in a record account first.
 */
export async function getConfidentialWithdrawInstructionPlan(
    input: GetConfidentialWithdrawInstructionPlanInput,
): Promise<InstructionPlan> {
    const proofData = buildConfidentialWithdrawProofData(input);
    const [equalityProofPlan, rangeProofPlan] = await Promise.all([
        buildContextStateProofPlan(
            proofData.equalityProofData.toBytes(),
            verifyCiphertextCommitmentEquality,
            input.payer,
            input.rpc,
        ),
        buildContextStateProofPlan(
            proofData.rangeProofData.toBytes(),
            verifyBatchedRangeProofU64,
            input.payer,
            input.rpc,
        ),
    ]);
    return assembleConfidentialWithdrawPlan(input, proofData, { equalityProofPlan, rangeProofPlan });
}

/**
 * Like {@link getConfidentialWithdrawInstructionPlan}, but stages the batched
 * range proof in an SPL Record account before verifying it, rather than passing
 * it inline in the verify instruction data.
 *
 * This shrinks the range-proof verification transaction so it leaves room for a
 * compute-unit-limit instruction, at the cost of extra transactions to create,
 * write and close the record account. Prefer this variant when sending with the
 * default transaction plan executor, which reserves a compute-unit-limit
 * instruction that would otherwise push the inline transaction over the size
 * limit.
 */
export async function getConfidentialWithdrawWithRecordInstructionPlan(
    input: GetConfidentialWithdrawWithRecordInstructionPlanInput,
): Promise<InstructionPlan> {
    const proofData = buildConfidentialWithdrawProofData(input);
    const [equalityProofPlan, rangeProofPlan] = await Promise.all([
        buildContextStateProofPlan(
            proofData.equalityProofData.toBytes(),
            verifyCiphertextCommitmentEquality,
            input.payer,
            input.rpc,
        ),
        buildContextStateProofPlan(
            proofData.rangeProofData.toBytes(),
            verifyBatchedRangeProofU64,
            input.payer,
            input.rpc,
            input.payer,
            input.recordPayer ?? input.payer,
            input.recordAuthority,
            input.recordRentReceiver,
        ),
    ]);
    return assembleConfidentialWithdrawPlan(input, proofData, { equalityProofPlan, rangeProofPlan });
}

// The proof data and instruction fields for a confidential transfer, derived
// from the input independently of how each proof is delivered on-chain.
type ConfidentialTransferProofData = {
    equalityProofData: CiphertextCommitmentEqualityProofData;
    ciphertextValidityProofData: BatchedGroupedCiphertext3HandlesValidityProofData;
    rangeProofData: BatchedRangeProofU128Data;
    transferAmountAuditorCiphertextLo: ReadonlyUint8Array;
    transferAmountAuditorCiphertextHi: ReadonlyUint8Array;
    newAvailableBalance: bigint;
};

async function buildConfidentialTransferProofData(
    input: GetConfidentialTransferInstructionPlanInput,
): Promise<ConfidentialTransferProofData> {
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

    return {
        equalityProofData,
        ciphertextValidityProofData,
        rangeProofData,
        transferAmountAuditorCiphertextLo,
        transferAmountAuditorCiphertextHi,
        newAvailableBalance,
    };
}

function assembleConfidentialTransferPlan(
    input: GetConfidentialTransferInstructionPlanInput,
    proofData: ConfidentialTransferProofData,
    proofPlans: {
        equalityProofPlan: ContextStateProofPlan;
        ciphertextValidityProofPlan: ContextStateProofPlan;
        rangeProofPlan: ContextStateProofPlan;
    },
): InstructionPlan {
    const { equalityProofPlan, ciphertextValidityProofPlan, rangeProofPlan } = proofPlans;
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
                newSourceDecryptableAvailableBalance: input.aesKey.encrypt(proofData.newAvailableBalance).toBytes(),
                transferAmountAuditorCiphertextLo: proofData.transferAmountAuditorCiphertextLo,
                transferAmountAuditorCiphertextHi: proofData.transferAmountAuditorCiphertextHi,
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
 * two accounts. Splits the amount into lo/hi halves and verifies the three
 * required proofs (equality, grouped-ciphertext validity, batched range)
 * via context-state accounts.
 *
 * The range proof is provided inline in the verify instruction data. This keeps
 * the flow to a minimal number of transactions, but the range-proof transaction
 * sits close to the transaction size limit and cannot accommodate an extra
 * compute-unit-limit instruction. Callers that send with a transaction plan
 * executor which sets compute-unit limits (e.g. by simulating) should either
 * disable that estimation or use {@link getConfidentialTransferWithRecordInstructionPlan},
 * which stages the range proof in a record account first.
 */
export async function getConfidentialTransferInstructionPlan(
    input: GetConfidentialTransferInstructionPlanInput,
): Promise<InstructionPlan> {
    const proofData = await buildConfidentialTransferProofData(input);
    const [equalityProofPlan, ciphertextValidityProofPlan, rangeProofPlan] = await Promise.all([
        buildContextStateProofPlan(
            proofData.equalityProofData.toBytes(),
            verifyCiphertextCommitmentEquality,
            input.payer,
            input.rpc,
        ),
        buildContextStateProofPlan(
            proofData.ciphertextValidityProofData.toBytes(),
            verifyBatchedGroupedCiphertext3HandlesValidity,
            input.payer,
            input.rpc,
        ),
        buildContextStateProofPlan(
            proofData.rangeProofData.toBytes(),
            verifyBatchedRangeProofU128,
            input.payer,
            input.rpc,
        ),
    ]);
    return assembleConfidentialTransferPlan(input, proofData, {
        equalityProofPlan,
        ciphertextValidityProofPlan,
        rangeProofPlan,
    });
}

/**
 * Like {@link getConfidentialTransferInstructionPlan}, but stages the batched
 * range proof in an SPL Record account before verifying it, rather than passing
 * it inline in the verify instruction data.
 *
 * This shrinks the range-proof verification transaction so it leaves room for a
 * compute-unit-limit instruction, at the cost of extra transactions to create,
 * write and close the record account. Prefer this variant when sending with the
 * default transaction plan executor, which reserves a compute-unit-limit
 * instruction that would otherwise push the inline transaction over the size
 * limit.
 */
export async function getConfidentialTransferWithRecordInstructionPlan(
    input: GetConfidentialTransferWithRecordInstructionPlanInput,
): Promise<InstructionPlan> {
    const proofData = await buildConfidentialTransferProofData(input);
    const [equalityProofPlan, ciphertextValidityProofPlan, rangeProofPlan] = await Promise.all([
        buildContextStateProofPlan(
            proofData.equalityProofData.toBytes(),
            verifyCiphertextCommitmentEquality,
            input.payer,
            input.rpc,
        ),
        buildContextStateProofPlan(
            proofData.ciphertextValidityProofData.toBytes(),
            verifyBatchedGroupedCiphertext3HandlesValidity,
            input.payer,
            input.rpc,
        ),
        buildContextStateProofPlan(
            proofData.rangeProofData.toBytes(),
            verifyBatchedRangeProofU128,
            input.payer,
            input.rpc,
            input.payer,
            input.recordPayer ?? input.payer,
            input.recordAuthority,
            input.recordRentReceiver,
        ),
    ]);
    return assembleConfidentialTransferPlan(input, proofData, {
        equalityProofPlan,
        ciphertextValidityProofPlan,
        rangeProofPlan,
    });
}

/**
 * Returns an instruction plan that confidentially transfers tokens between
 * two accounts when the mint is configured for confidential transfer fees.
 * Builds and verifies the five proofs required by `TransferWithFee` via
 * context-state accounts, using the `@solana/zk-sdk` Pedersen arithmetic API
 * to derive the combined fee and net-transfer commitments.
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
    const combinedTransferAmountCommitment = PedersenCommitment.combineLoHi(
        transferAmountCommitmentLo,
        transferAmountCommitmentHi,
        Number(TRANSFER_AMOUNT_LO_BIT_LENGTH),
    );
    const combinedTransferAmountOpening = PedersenOpening.combineLoHi(
        transferAmountOpeningLo,
        transferAmountOpeningHi,
        Number(TRANSFER_AMOUNT_LO_BIT_LENGTH),
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
    const combinedFeeCommitment = PedersenCommitment.combineLoHi(
        feeCommitmentLo,
        feeCommitmentHi,
        Number(FEE_AMOUNT_LO_BIT_LENGTH),
    );
    const combinedFeeOpening = PedersenOpening.combineLoHi(
        feeOpeningLo,
        feeOpeningHi,
        Number(FEE_AMOUNT_LO_BIT_LENGTH),
    );

    const netTransferAmountCommitment = combinedTransferAmountCommitment.subtract(combinedFeeCommitment);
    const netTransferAmountOpening = combinedTransferAmountOpening.subtract(combinedFeeOpening);
    const claimedOpening = new PedersenOpening();
    const claimedCommitment = PedersenCommitment.from(claimedDeltaFee, claimedOpening);
    const deltaCommitment = combinedFeeCommitment
        .multiplyByU64(MAX_FEE_BASIS_POINTS)
        .subtract(combinedTransferAmountCommitment.multiplyByU64(BigInt(transferFee.transferFeeBasisPoints)));
    const deltaOpening = combinedFeeOpening
        .multiplyByU64(MAX_FEE_BASIS_POINTS)
        .subtract(combinedTransferAmountOpening.multiplyByU64(BigInt(transferFee.transferFeeBasisPoints)));
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

    const zeroOpening = PedersenOpening.zero();
    const maxFeeBasisPointsSubOneCommitment = PedersenCommitment.from(MAX_FEE_BASIS_POINTS_SUB_ONE, zeroOpening);
    const claimedComplementCommitment = maxFeeBasisPointsSubOneCommitment.subtract(claimedCommitment);
    const claimedComplementOpening = zeroOpening.subtract(claimedOpening);
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
