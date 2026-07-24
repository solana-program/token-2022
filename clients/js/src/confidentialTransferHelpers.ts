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
    getConfidentialWithdrawInstruction,
    getConfigureConfidentialTransferAccountInstruction,
    getCreateAssociatedTokenIdempotentInstruction,
    getEmptyConfidentialTransferAccountInstruction,
    getReallocateInstruction,
    getUpdateConfidentialMintBurnDecryptableSupplyInstruction,
    fetchToken,
} from './generated';

const DEFAULT_MAXIMUM_PENDING_BALANCE_CREDIT_COUNTER = 1n << 16n;
const PENDING_BALANCE_LO_BIT_LENGTH = 16n;
const TRANSFER_AMOUNT_LO_BIT_LENGTH = 16n;
const TRANSFER_AMOUNT_HI_BIT_LENGTH = 32n;
const REMAINING_BALANCE_BIT_LENGTH = 64;
const RANGE_PROOF_PADDING_BIT_LENGTH = 16;
// A mint/burn amount is range-proven as a 16-bit low half + 32-bit high half, so
// it must fit in 48 bits (matching the Rust reference); a larger amount would
// otherwise silently produce a range proof the on-chain verifier rejects.
const MAX_MINT_BURN_AMOUNT = (1n << (TRANSFER_AMOUNT_LO_BIT_LENGTH + TRANSFER_AMOUNT_HI_BIT_LENGTH)) - 1n;
const U64_MAX = (1n << 64n) - 1n;

type ConfidentialTransferAccountExtension = Extract<Extension, { __kind: 'ConfidentialTransferAccount' }>;
type ConfidentialTransferMintExtension = Extract<Extension, { __kind: 'ConfidentialTransferMint' }>;
type ConfidentialMintBurnExtension = Extract<Extension, { __kind: 'ConfidentialMintBurn' }>;

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

export type GetConfidentialMintInstructionPlanInput = {
    payer: TransactionSigner;
    rpc: Rpc<GetMinimumBalanceForRentExemptionApi>;
    /** The token account minted into (its confidential pending balance). */
    token: Address;
    mint: Address;
    /** Decoded mint account, read for the `ConfidentialMintBurn` supply state and auditor key. */
    mintAccount: Mint;
    /** Decoded destination token account, read for its ElGamal public key. */
    destinationTokenAccount: Token;
    authority: Address | TransactionSigner;
    amount: number | bigint;
    /** The supply ElGamal keypair (backs the equality proof; encrypts the new supply). */
    supplyElgamalKeypair: ElGamalKeypair;
    /** The supply AES key (decrypts the current supply and encrypts the new decryptable supply). */
    supplyAesKey: AeKey;
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

export type GetConfidentialBurnInstructionPlanInput = {
    payer: TransactionSigner;
    rpc: Rpc<GetMinimumBalanceForRentExemptionApi>;
    /** The token account burnt from (its confidential available balance). */
    token: Address;
    mint: Address;
    /** Decoded mint account, read for the `ConfidentialMintBurn` supply ElGamal pubkey and auditor key. */
    mintAccount: Mint;
    /** Decoded source token account, read for its available-balance ciphertext and ElGamal public key. */
    sourceTokenAccount: Token;
    authority: Address | TransactionSigner;
    amount: number | bigint;
    /** The source account's ElGamal keypair (backs the equality proof). */
    sourceElgamalKeypair: ElGamalKeypair;
    /** The source account's AES key (decrypts and re-encrypts the available balance). */
    aesKey: AeKey;
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

function getRequiredConfidentialMintBurnExtension(mint: Mint): ConfidentialMintBurnExtension {
    if (!isSome(mint.extensions)) {
        throw new Error('Mint account is missing extensions.');
    }

    const extension = mint.extensions.value.find(candidate => candidate.__kind === 'ConfidentialMintBurn') as
        | ConfidentialMintBurnExtension
        | undefined;
    if (!extension) {
        throw new Error('Mint account is missing the ConfidentialMintBurn extension.');
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

function resolveAuditorElGamalPubkey(mintAccount: Mint, auditorElgamalPubkey?: Address) {
    if (auditorElgamalPubkey) {
        return getElGamalPubkeyFromAddress(auditorElgamalPubkey);
    }

    const extension = getRequiredConfidentialTransferMintExtension(mintAccount);
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
 */
export async function getConfidentialMintInstructionPlan(
    input: GetConfidentialMintInstructionPlanInput,
): Promise<InstructionPlan> {
    const mintBurnExtension = getRequiredConfidentialMintBurnExtension(input.mintAccount);
    const amount = BigInt(input.amount);
    assertMintBurnAmount(amount, 'Mint');

    const currentSupply = input.supplyAesKey.decrypt(parseAeCiphertext(mintBurnExtension.decryptableSupply));
    const newSupply = currentSupply + amount;
    if (newSupply > U64_MAX) {
        throw new Error('Mint would overflow the maximum u64 supply.');
    }

    const [amountLo, amountHi] = splitAmount(amount, TRANSFER_AMOUNT_LO_BIT_LENGTH);
    const destinationPubkey = getElGamalPubkeyFromAddress(
        getRequiredConfidentialTransferAccountExtension(input.destinationTokenAccount).elgamalPubkey,
    );
    const supplyPubkey = input.supplyElgamalKeypair.pubkey();
    const auditorPubkey = resolveAuditorElGamalPubkey(input.mintAccount, input.auditorElgamalPubkey);

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
 * Returns an instruction plan that confidentially burns `amount` tokens from a
 * token account's available balance, encrypting the amount on-chain and
 * advancing the mint's encrypted pending burn. Symmetric to
 * `getConfidentialMintInstructionPlan`.
 *
 * The amount is grouped-encrypted under `[source, supply, auditor]`; the source
 * handle (index 0) is homomorphically subtracted from the account's available
 * balance, and the auditor handle (index 2) is carried by the instruction.
 */
export async function getConfidentialBurnInstructionPlan(
    input: GetConfidentialBurnInstructionPlanInput,
): Promise<InstructionPlan> {
    const sourceAccount = getRequiredConfidentialTransferAccountExtension(input.sourceTokenAccount);
    const mintBurnExtension = getRequiredConfidentialMintBurnExtension(input.mintAccount);
    const amount = BigInt(input.amount);
    assertMintBurnAmount(amount, 'Burn');

    const currentAvailableBalance = decryptAvailableBalance(sourceAccount, input.aesKey);
    const remainingBalance = computeNewAvailableBalance(currentAvailableBalance, amount);

    const [amountLo, amountHi] = splitAmount(amount, TRANSFER_AMOUNT_LO_BIT_LENGTH);
    const sourcePubkey = input.sourceElgamalKeypair.pubkey();
    const supplyPubkey = getElGamalPubkeyFromAddress(mintBurnExtension.supplyElgamalPubkey);
    const auditorPubkey = resolveAuditorElGamalPubkey(input.mintAccount, input.auditorElgamalPubkey);

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

    return sequentialInstructionPlan([
        parallelInstructionPlan([equalityProofPlan.setup, ciphertextValidityProofPlan.setup, rangeProofPlan.setup]),
        getConfidentialBurnInstruction(
            {
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
    if (supply < 0n || supply > U64_MAX) {
        throw new Error(`supply must be a u64 (0..2^64-1), got ${supply}.`);
    }

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
