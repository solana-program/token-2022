import {
    closeContextStateProof,
    verifyBatchedGroupedCiphertext3HandlesValidity,
    verifyBatchedRangeProofU128,
    verifyBatchedRangeProofU64,
    verifyCiphertextCommitmentEquality,
    verifyPubkeyValidity,
} from '@solana-program/zk-elgamal-proof';
import {
    AccountRole,
    Address,
    Instruction,
    TransactionSigner,
    generateKeyPairSigner,
    getAddressEncoder,
    getI8Encoder,
    getStructEncoder,
    getU8Encoder,
    isSome,
    nonDivisibleSequentialInstructionPlan,
    parallelInstructionPlan,
    sequentialInstructionPlan,
    singleInstructionPlan,
    type AccountMeta,
    type GetMinimumBalanceForRentExemptionApi,
    type InstructionPlan,
    type ReadonlyUint8Array,
    type Rpc,
} from '@solana/kit';
import {
    CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
    CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
    ExtensionType,
    Extension,
    TOKEN_2022_PROGRAM_ADDRESS,
    Token,
    findAssociatedTokenPda,
    getApplyConfidentialPendingBalanceInstruction,
    getConfidentialWithdrawInstructionDataEncoder,
    getConfigureConfidentialTransferAccountInstructionDataEncoder,
    getCreateAssociatedTokenIdempotentInstruction,
    getDecryptableBalanceEncoder,
    getEncryptedBalanceEncoder,
    getReallocateInstruction,
} from './generated';
import {
    extractCiphertextFromGroupedBytes,
    subtractAmountFromCiphertext,
    subtractWithLoHiCiphertexts,
} from './confidentialTransferArithmetic';

const DEFAULT_MAXIMUM_PENDING_BALANCE_CREDIT_COUNTER = 1n << 16n;
const PENDING_BALANCE_LO_BIT_LENGTH = 16n;
const TRANSFER_AMOUNT_LO_BIT_LENGTH = 16n;
const TRANSFER_AMOUNT_HI_BIT_LENGTH = 32n;
const REMAINING_BALANCE_BIT_LENGTH = 64;
const RANGE_PROOF_PADDING_BIT_LENGTH = 16;

const INSTRUCTIONS_SYSVAR_ADDRESS =
    'Sysvar1nstructions1111111111111111111111111' as Address<'Sysvar1nstructions1111111111111111111111111'>;

type BytesLike = { toBytes(): Uint8Array };

export type ConfidentialTransferZkAeCiphertext = BytesLike;
export type ConfidentialTransferZkElGamalCiphertext = BytesLike;
export type ConfidentialTransferZkPedersenCommitment = BytesLike;
export type ConfidentialTransferZkPedersenOpening = object;
export type ConfidentialTransferZkGroupedElGamalCiphertext3Handles = BytesLike;
export type ConfidentialTransferZkProofContext = BytesLike;
export type ConfidentialTransferZkProofData = BytesLike & {
    context(): ConfidentialTransferZkProofContext;
};

export type ConfidentialTransferZkAeKey = BytesLike & {
    decrypt(ciphertext: ConfidentialTransferZkAeCiphertext): bigint;
    encrypt(amount: bigint): ConfidentialTransferZkAeCiphertext;
};

export type ConfidentialTransferZkElGamalSecretKey = BytesLike & {
    decrypt(ciphertext: ConfidentialTransferZkElGamalCiphertext): bigint;
};

export type ConfidentialTransferZkElGamalPubkey = BytesLike & {
    encryptWith(
        amount: bigint,
        opening: ConfidentialTransferZkPedersenOpening,
    ): ConfidentialTransferZkElGamalCiphertext;
};

export type ConfidentialTransferZkElGamalKeypair = {
    pubkey(): ConfidentialTransferZkElGamalPubkey;
    secret(): ConfidentialTransferZkElGamalSecretKey;
};

/**
 * Interface that any JS/WASM-backed ZK client must satisfy to be used with
 * the confidential transfer helpers. This decouples the helpers from a
 * specific `@solana/zk-sdk` version — callers provide their own client.
 */
export type ConfidentialTransferZkClient = {
    AeCiphertext: {
        fromBytes(bytes: Uint8Array): ConfidentialTransferZkAeCiphertext | undefined;
    };
    ElGamalCiphertext: {
        fromBytes(bytes: Uint8Array): ConfidentialTransferZkElGamalCiphertext | undefined;
    };
    ElGamalPubkey: {
        fromBytes(bytes: Uint8Array): ConfidentialTransferZkElGamalPubkey;
    };
    GroupedElGamalCiphertext3Handles: {
        encryptWith(
            firstPubkey: ConfidentialTransferZkElGamalPubkey,
            secondPubkey: ConfidentialTransferZkElGamalPubkey,
            thirdPubkey: ConfidentialTransferZkElGamalPubkey,
            amount: bigint,
            opening: ConfidentialTransferZkPedersenOpening,
        ): ConfidentialTransferZkGroupedElGamalCiphertext3Handles;
    };
    PedersenCommitment: {
        from(amount: bigint, opening: ConfidentialTransferZkPedersenOpening): ConfidentialTransferZkPedersenCommitment;
        fromBytes(bytes: Uint8Array): ConfidentialTransferZkPedersenCommitment;
    };
    PedersenOpening: new () => ConfidentialTransferZkPedersenOpening;
    PubkeyValidityProofData: new (keypair: ConfidentialTransferZkElGamalKeypair) => ConfidentialTransferZkProofData;
    CiphertextCommitmentEqualityProofData: new (
        keypair: ConfidentialTransferZkElGamalKeypair,
        ciphertext: ConfidentialTransferZkElGamalCiphertext,
        commitment: ConfidentialTransferZkPedersenCommitment,
        opening: ConfidentialTransferZkPedersenOpening,
        amount: bigint,
    ) => ConfidentialTransferZkProofData;
    BatchedRangeProofU64Data: new (
        commitments: ConfidentialTransferZkPedersenCommitment[],
        amounts: BigUint64Array,
        bitLengths: Uint8Array,
        openings: ConfidentialTransferZkPedersenOpening[],
    ) => ConfidentialTransferZkProofData;
    BatchedRangeProofU128Data: new (
        commitments: ConfidentialTransferZkPedersenCommitment[],
        amounts: BigUint64Array,
        bitLengths: Uint8Array,
        openings: ConfidentialTransferZkPedersenOpening[],
    ) => ConfidentialTransferZkProofData;
    BatchedGroupedCiphertext3HandlesValidityProofData: new (
        firstPubkey: ConfidentialTransferZkElGamalPubkey,
        secondPubkey: ConfidentialTransferZkElGamalPubkey,
        thirdPubkey: ConfidentialTransferZkElGamalPubkey,
        groupedCiphertextLo: ConfidentialTransferZkGroupedElGamalCiphertext3Handles,
        groupedCiphertextHi: ConfidentialTransferZkGroupedElGamalCiphertext3Handles,
        amountLo: bigint,
        amountHi: bigint,
        openingLo: ConfidentialTransferZkPedersenOpening,
        openingHi: ConfidentialTransferZkPedersenOpening,
    ) => ConfidentialTransferZkProofData;
    AeKey: {
        signerMessage(publicSeed: Uint8Array): Uint8Array;
        fromSignature(signature: Uint8Array): ConfidentialTransferZkAeKey;
    };
    ElGamalKeypair: {
        signerMessage(publicSeed: Uint8Array): Uint8Array;
        fromSignature(signature: Uint8Array): ConfidentialTransferZkElGamalKeypair;
    };
};

type ConfidentialTransferAccountExtension = Extract<Extension, { __kind: 'ConfidentialTransferAccount' }>;

type ConfidentialTransferProofDataLocation =
    | {
          instructionOffset: number;
          contextStateAccount?: never;
      }
    | {
          instructionOffset?: never;
          contextStateAccount: Address;
      };

type ContextStateProofMode = {
    proofMode?: 'context-state';
    payer: TransactionSigner;
    rpc: Rpc<GetMinimumBalanceForRentExemptionApi>;
};

export type GetCreateConfidentialTransferAccountInstructionsInput = {
    payer: TransactionSigner;
    owner: Address | TransactionSigner;
    mint: Address;
    token?: Address;
    authority?: Address | TransactionSigner;
    rpc: Rpc<GetMinimumBalanceForRentExemptionApi>;
    zk: ConfidentialTransferZkClient;
    elgamalKeypair: ConfidentialTransferZkElGamalKeypair;
    aesKey: ConfidentialTransferZkAeKey;
    maximumPendingBalanceCreditCounter?: number | bigint;
    multiSigners?: Array<TransactionSigner>;
    programAddress?: Address;
};

export type GetApplyConfidentialPendingBalanceInstructionFromTokenInput = {
    token: Address;
    tokenAccount: Token;
    authority: Address | TransactionSigner;
    zk: ConfidentialTransferZkClient;
    elgamalSecretKey: ConfidentialTransferZkElGamalSecretKey;
    aesKey: ConfidentialTransferZkAeKey;
    multiSigners?: Array<TransactionSigner>;
    programAddress?: Address;
};

type GetConfidentialWithdrawInstructionsBaseInput = {
    token: Address;
    mint: Address;
    tokenAccount: Token;
    authority: Address | TransactionSigner;
    amount: number | bigint;
    decimals: number;
    zk: ConfidentialTransferZkClient;
    elgamalKeypair: ConfidentialTransferZkElGamalKeypair;
    aesKey: ConfidentialTransferZkAeKey;
    multiSigners?: Array<TransactionSigner>;
    programAddress?: Address;
};

export type GetConfidentialWithdrawInstructionsInput = GetConfidentialWithdrawInstructionsBaseInput &
    ContextStateProofMode;

type GetConfidentialTransferInstructionsBaseInput = {
    sourceToken: Address;
    mint: Address;
    destinationToken: Address;
    sourceTokenAccount: Token;
    auditorElgamalPubkey?: Address;
    authority: Address | TransactionSigner;
    amount: number | bigint;
    zk: ConfidentialTransferZkClient;
    sourceElgamalKeypair: ConfidentialTransferZkElGamalKeypair;
    aesKey: ConfidentialTransferZkAeKey;
    multiSigners?: Array<TransactionSigner>;
    programAddress?: Address;
} & (
    | { destinationTokenAccount: Token; destinationElgamalPubkey?: Address }
    | { destinationElgamalPubkey: Address; destinationTokenAccount?: never }
);

export type GetConfidentialTransferInstructionsInput = GetConfidentialTransferInstructionsBaseInput &
    ContextStateProofMode;

// codama bug: the generated ConfidentialTransfer encoder is missing
// `transferAmountAuditorCiphertextLo` and `transferAmountAuditorCiphertextHi`,
// which the on-chain program reads from the instruction data. Wrapped in a
// function so the encoder is not constructed at import time.
function getConfidentialTransferWithAuditorCiphertextsEncoder() {
    return getStructEncoder([
        ['discriminator', getU8Encoder()],
        ['confidentialTransferDiscriminator', getU8Encoder()],
        ['newSourceDecryptableAvailableBalance', getDecryptableBalanceEncoder()],
        ['transferAmountAuditorCiphertextLo', getEncryptedBalanceEncoder()],
        ['transferAmountAuditorCiphertextHi', getEncryptedBalanceEncoder()],
        ['equalityProofInstructionOffset', getI8Encoder()],
        ['ciphertextValidityProofInstructionOffset', getI8Encoder()],
        ['rangeProofInstructionOffset', getI8Encoder()],
    ]);
}

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

function parseAeCiphertext(zk: ConfidentialTransferZkClient, bytes: ReadonlyUint8Array) {
    const ciphertext = zk.AeCiphertext.fromBytes(new Uint8Array(bytes));
    if (!ciphertext) {
        throw new Error('Failed to deserialize an authenticated-encryption ciphertext.');
    }
    return ciphertext;
}

function parseElGamalCiphertext(zk: ConfidentialTransferZkClient, bytes: ReadonlyUint8Array) {
    const ciphertext = zk.ElGamalCiphertext.fromBytes(new Uint8Array(bytes));
    if (!ciphertext) {
        throw new Error('Failed to deserialize an ElGamal ciphertext.');
    }
    return ciphertext;
}

function getElGamalPubkeyFromAddress(zk: ConfidentialTransferZkClient, value: Address) {
    return zk.ElGamalPubkey.fromBytes(new Uint8Array(getAddressEncoder().encode(value)));
}

function getDefaultAuditorElGamalPubkey(zk: ConfidentialTransferZkClient) {
    return zk.ElGamalPubkey.fromBytes(new Uint8Array(32));
}

function getDestinationElGamalPubkey(input: GetConfidentialTransferInstructionsInput) {
    if (input.destinationElgamalPubkey) {
        return getElGamalPubkeyFromAddress(input.zk, input.destinationElgamalPubkey);
    }
    if (!input.destinationTokenAccount) {
        throw new Error('Destination confidential transfer state is required.');
    }

    return getElGamalPubkeyFromAddress(
        input.zk,
        getRequiredConfidentialTransferAccountExtension(input.destinationTokenAccount).elgamalPubkey,
    );
}

function toBigIntAmount(amount: number | bigint) {
    return typeof amount === 'bigint' ? amount : BigInt(amount);
}

function splitAmount(amount: bigint, bitLength: bigint): [bigint, bigint] {
    const mask = (1n << bitLength) - 1n;
    return [amount & mask, amount >> bitLength];
}

function combineBalances(balanceLo: bigint, balanceHi: bigint) {
    return (balanceHi << PENDING_BALANCE_LO_BIT_LENGTH) + balanceLo;
}

function decryptAvailableBalance(
    zk: ConfidentialTransferZkClient,
    account: ConfidentialTransferAccountExtension,
    aesKey: ConfidentialTransferZkAeKey,
) {
    return aesKey.decrypt(parseAeCiphertext(zk, account.decryptableAvailableBalance));
}

function hasInstructionOffset(proofLocations: ConfidentialTransferProofDataLocation[]) {
    return proofLocations.some(proofLocation => proofLocation.instructionOffset !== undefined);
}

function assertInstructionDataProofModeIsUnsupported(input: { proofMode?: string }) {
    if (input.proofMode === 'instruction-data') {
        throw new Error(
            'instruction-data proof mode is unsupported for confidential withdraw/transfer helpers in clients/js; use the default context-state flow.',
        );
    }
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
function computeNewAvailableBalance(currentBalance: bigint, amount: bigint): bigint {
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

function getReadonlyAuthorityAccountMeta(authority: Address | TransactionSigner) {
    return Object.freeze({
        address: addressOf(authority),
        role: isSigner(authority) ? AccountRole.READONLY_SIGNER : AccountRole.READONLY,
        ...(isSigner(authority) ? { signer: authority } : {}),
    });
}

function getRemainingReadonlySignerAccounts(multiSigners?: Array<TransactionSigner>) {
    return (multiSigners ?? []).map(
        signer =>
            Object.freeze({
                address: signer.address,
                role: AccountRole.READONLY_SIGNER,
                signer,
            }) satisfies AccountMeta,
    );
}

// codama bug: the generated `getConfigureConfidentialTransferAccountInstruction`
// emits a 5-account layout (with a `record` slot) that only matches the
// `ConfigureAccountWithRegistry` on-chain path. In `ProofInstructionOffset`
// mode the on-chain handler reads 4 accounts, so the program-ID-padded
// `record` slot ends up in the authority position. Hand-build the
// 4-account form until the IDL splits the two configure variants.
function getConfigureConfidentialTransferAccountInstructionWithProof(input: {
    token: Address;
    mint: Address;
    authority: Address | TransactionSigner;
    decryptableZeroBalance: ReadonlyUint8Array;
    maximumPendingBalanceCreditCounter: number | bigint;
    proofInstructionOffset: number;
    multiSigners?: Array<TransactionSigner>;
    programAddress?: Address;
}) {
    return Object.freeze({
        accounts: [
            { address: input.token, role: AccountRole.WRITABLE },
            { address: input.mint, role: AccountRole.READONLY },
            { address: INSTRUCTIONS_SYSVAR_ADDRESS, role: AccountRole.READONLY },
            getReadonlyAuthorityAccountMeta(input.authority),
            ...getRemainingReadonlySignerAccounts(input.multiSigners),
        ],
        data: getConfigureConfidentialTransferAccountInstructionDataEncoder().encode({
            decryptableZeroBalance: input.decryptableZeroBalance,
            maximumPendingBalanceCreditCounter: input.maximumPendingBalanceCreditCounter,
            proofInstructionOffset: input.proofInstructionOffset,
        }),
        programAddress: getTokenProgramAddress(input.programAddress),
    } as Instruction);
}

// codama bug: same shape as the configure helper above. The on-chain
// `verify_withdraw_proof` consumes 0–3 conditional accounts between mint
// and authority (sysvar when either offset != 0; one context-state account
// per offset == 0). The generated builder always emits a fixed 6-account
// layout with program-ID placeholders, putting accounts in the wrong slots.
function getConfidentialWithdrawInstructionWithProof(input: {
    token: Address;
    mint: Address;
    authority: Address | TransactionSigner;
    amount: number | bigint;
    decimals: number;
    newDecryptableAvailableBalance: ReadonlyUint8Array;
    equalityProofLocation: ConfidentialTransferProofDataLocation;
    rangeProofLocation: ConfidentialTransferProofDataLocation;
    multiSigners?: Array<TransactionSigner>;
    programAddress?: Address;
}) {
    const accounts: AccountMeta[] = [
        { address: input.token, role: AccountRole.WRITABLE },
        { address: input.mint, role: AccountRole.READONLY },
    ];

    if (hasInstructionOffset([input.equalityProofLocation, input.rangeProofLocation])) {
        accounts.push({ address: INSTRUCTIONS_SYSVAR_ADDRESS, role: AccountRole.READONLY });
    }

    if (input.equalityProofLocation.contextStateAccount) {
        accounts.push({ address: input.equalityProofLocation.contextStateAccount, role: AccountRole.READONLY });
    }
    if (input.rangeProofLocation.contextStateAccount) {
        accounts.push({ address: input.rangeProofLocation.contextStateAccount, role: AccountRole.READONLY });
    }
    accounts.push(getReadonlyAuthorityAccountMeta(input.authority));
    accounts.push(...getRemainingReadonlySignerAccounts(input.multiSigners));

    return Object.freeze({
        accounts,
        data: getConfidentialWithdrawInstructionDataEncoder().encode({
            amount: input.amount,
            decimals: input.decimals,
            newDecryptableAvailableBalance: input.newDecryptableAvailableBalance,
            equalityProofInstructionOffset: input.equalityProofLocation.instructionOffset ?? 0,
            rangeProofInstructionOffset: input.rangeProofLocation.instructionOffset ?? 0,
        }),
        programAddress: getTokenProgramAddress(input.programAddress),
    } as Instruction);
}

function getConfidentialTransferInstructionWithAuditorCiphertexts(input: {
    sourceToken: Address;
    mint: Address;
    destinationToken: Address;
    authority: Address | TransactionSigner;
    newSourceDecryptableAvailableBalance: ReadonlyUint8Array;
    transferAmountAuditorCiphertextLo: ReadonlyUint8Array;
    transferAmountAuditorCiphertextHi: ReadonlyUint8Array;
    equalityProofLocation: ConfidentialTransferProofDataLocation;
    ciphertextValidityProofLocation: ConfidentialTransferProofDataLocation;
    rangeProofLocation: ConfidentialTransferProofDataLocation;
    multiSigners?: Array<TransactionSigner>;
    programAddress?: Address;
}) {
    const programAddress = getTokenProgramAddress(input.programAddress);
    const accounts: AccountMeta[] = [
        { address: input.sourceToken, role: AccountRole.WRITABLE },
        { address: input.mint, role: AccountRole.READONLY },
        { address: input.destinationToken, role: AccountRole.WRITABLE },
    ];

    if (
        hasInstructionOffset([
            input.equalityProofLocation,
            input.ciphertextValidityProofLocation,
            input.rangeProofLocation,
        ])
    ) {
        accounts.push({ address: INSTRUCTIONS_SYSVAR_ADDRESS, role: AccountRole.READONLY });
    }

    if (input.equalityProofLocation.contextStateAccount) {
        accounts.push({ address: input.equalityProofLocation.contextStateAccount, role: AccountRole.READONLY });
    }
    if (input.ciphertextValidityProofLocation.contextStateAccount) {
        accounts.push({
            address: input.ciphertextValidityProofLocation.contextStateAccount,
            role: AccountRole.READONLY,
        });
    }
    if (input.rangeProofLocation.contextStateAccount) {
        accounts.push({ address: input.rangeProofLocation.contextStateAccount, role: AccountRole.READONLY });
    }
    accounts.push(getReadonlyAuthorityAccountMeta(input.authority));
    accounts.push(...getRemainingReadonlySignerAccounts(input.multiSigners));

    return Object.freeze({
        accounts,
        data: getConfidentialTransferWithAuditorCiphertextsEncoder().encode({
            discriminator: CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
            confidentialTransferDiscriminator: CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
            newSourceDecryptableAvailableBalance: input.newSourceDecryptableAvailableBalance,
            transferAmountAuditorCiphertextLo: input.transferAmountAuditorCiphertextLo,
            transferAmountAuditorCiphertextHi: input.transferAmountAuditorCiphertextHi,
            equalityProofInstructionOffset: input.equalityProofLocation.instructionOffset ?? 0,
            ciphertextValidityProofInstructionOffset: input.ciphertextValidityProofLocation.instructionOffset ?? 0,
            rangeProofInstructionOffset: input.rangeProofLocation.instructionOffset ?? 0,
        }),
        programAddress,
    } as Instruction);
}

/**
 * Returns a single-transaction plan that creates the ATA, reallocates it
 * for the confidential-transfer extension, configures the account, and
 * verifies the ZK pubkey-validity proof.
 */
export async function getCreateConfidentialTransferAccountInstructions(
    input: GetCreateConfidentialTransferAccountInstructionsInput,
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

    const pubkeyValidityProofData = new input.zk.PubkeyValidityProofData(input.elgamalKeypair);
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
        getConfigureConfidentialTransferAccountInstructionWithProof({
            token,
            mint: input.mint,
            authority,
            decryptableZeroBalance: input.aesKey.encrypt(0n).toBytes(),
            maximumPendingBalanceCreditCounter:
                input.maximumPendingBalanceCreditCounter ?? DEFAULT_MAXIMUM_PENDING_BALANCE_CREDIT_COUNTER,
            proofInstructionOffset: 1,
            multiSigners: input.multiSigners,
            programAddress,
        }),
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
): InstructionPlan {
    const account = getRequiredConfidentialTransferAccountExtension(input.tokenAccount);
    const pendingBalanceLo = input.elgamalSecretKey.decrypt(
        parseElGamalCiphertext(input.zk, account.pendingBalanceLow),
    );
    const pendingBalanceHi = input.elgamalSecretKey.decrypt(
        parseElGamalCiphertext(input.zk, account.pendingBalanceHigh),
    );
    const newDecryptableAvailableBalance = input.aesKey
        .encrypt(
            decryptAvailableBalance(input.zk, account, input.aesKey) +
                combineBalances(pendingBalanceLo, pendingBalanceHi),
        )
        .toBytes();

    return singleInstructionPlan(
        getApplyConfidentialPendingBalanceInstruction(
            {
                token: input.token,
                authority: input.authority,
                expectedPendingBalanceCreditCounter: account.pendingBalanceCreditCounter,
                newDecryptableAvailableBalance,
                multiSigners: input.multiSigners,
            },
            { programAddress: getTokenProgramAddress(input.programAddress) },
        ),
    );
}

/**
 * Returns an instruction plan that moves tokens from the encrypted
 * available balance back to the plaintext balance. Generates and verifies
 * the equality and batched range proofs via context-state accounts.
 */
export async function getConfidentialWithdrawInstructions(
    input: GetConfidentialWithdrawInstructionsInput,
): Promise<InstructionPlan> {
    assertInstructionDataProofModeIsUnsupported(input as { proofMode?: string });
    const account = getRequiredConfidentialTransferAccountExtension(input.tokenAccount);
    const amount = toBigIntAmount(input.amount);
    const newAvailableBalance = computeNewAvailableBalance(
        decryptAvailableBalance(input.zk, account, input.aesKey),
        amount,
    );

    const remainingBalanceOpening = new input.zk.PedersenOpening();
    const remainingBalanceCommitment = input.zk.PedersenCommitment.from(newAvailableBalance, remainingBalanceOpening);
    const remainingBalanceCiphertext = parseElGamalCiphertext(
        input.zk,
        subtractAmountFromCiphertext(account.availableBalance, amount),
    );

    const equalityProofData = new input.zk.CiphertextCommitmentEqualityProofData(
        input.elgamalKeypair,
        remainingBalanceCiphertext,
        remainingBalanceCommitment,
        remainingBalanceOpening,
        newAvailableBalance,
    );
    const rangeProofData = new input.zk.BatchedRangeProofU64Data(
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
        getConfidentialWithdrawInstructionWithProof({
            token: input.token,
            mint: input.mint,
            authority: input.authority,
            amount,
            decimals: input.decimals,
            newDecryptableAvailableBalance: input.aesKey.encrypt(newAvailableBalance).toBytes(),
            equalityProofLocation: { contextStateAccount: equalityProofPlan.address },
            rangeProofLocation: { contextStateAccount: rangeProofPlan.address },
            multiSigners: input.multiSigners,
            programAddress: input.programAddress,
        }),
        parallelInstructionPlan([equalityProofPlan.cleanup, rangeProofPlan.cleanup]),
    ]);
}

/**
 * Returns an instruction plan that confidentially transfers tokens between
 * two accounts. Splits the amount into lo/hi halves and verifies the three
 * required proofs (equality, grouped-ciphertext validity, batched range)
 * via context-state accounts.
 */
export async function getConfidentialTransferInstructions(
    input: GetConfidentialTransferInstructionsInput,
): Promise<InstructionPlan> {
    assertInstructionDataProofModeIsUnsupported(input as { proofMode?: string });
    const sourceAccount = getRequiredConfidentialTransferAccountExtension(input.sourceTokenAccount);
    const amount = toBigIntAmount(input.amount);
    const [transferAmountLo, transferAmountHi] = splitAmount(amount, TRANSFER_AMOUNT_LO_BIT_LENGTH);

    const sourcePubkey = input.sourceElgamalKeypair.pubkey();
    const destinationPubkey = getDestinationElGamalPubkey(input);
    const auditorPubkey = input.auditorElgamalPubkey
        ? getElGamalPubkeyFromAddress(input.zk, input.auditorElgamalPubkey)
        : getDefaultAuditorElGamalPubkey(input.zk);

    const openingLo = new input.zk.PedersenOpening();
    const openingHi = new input.zk.PedersenOpening();
    const groupedCiphertextLo = input.zk.GroupedElGamalCiphertext3Handles.encryptWith(
        sourcePubkey,
        destinationPubkey,
        auditorPubkey,
        transferAmountLo,
        openingLo,
    );
    const groupedCiphertextHi = input.zk.GroupedElGamalCiphertext3Handles.encryptWith(
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
        decryptAvailableBalance(input.zk, sourceAccount, input.aesKey),
        amount,
    );
    const newAvailableBalanceOpening = new input.zk.PedersenOpening();
    const newAvailableBalanceCommitment = input.zk.PedersenCommitment.from(
        newAvailableBalance,
        newAvailableBalanceOpening,
    );
    const newAvailableBalanceCiphertext = parseElGamalCiphertext(
        input.zk,
        subtractWithLoHiCiphertexts(
            sourceAccount.availableBalance,
            transferAmountSourceCiphertextLo,
            transferAmountSourceCiphertextHi,
            TRANSFER_AMOUNT_LO_BIT_LENGTH,
        ),
    );

    const equalityProofData = new input.zk.CiphertextCommitmentEqualityProofData(
        input.sourceElgamalKeypair,
        newAvailableBalanceCiphertext,
        newAvailableBalanceCommitment,
        newAvailableBalanceOpening,
        newAvailableBalance,
    );
    const ciphertextValidityProofData = new input.zk.BatchedGroupedCiphertext3HandlesValidityProofData(
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

    const commitmentLo = input.zk.PedersenCommitment.fromBytes(groupedCiphertextLoBytes.slice(0, 32));
    const commitmentHi = input.zk.PedersenCommitment.fromBytes(groupedCiphertextHiBytes.slice(0, 32));
    const paddingOpening = new input.zk.PedersenOpening();
    const paddingCommitment = input.zk.PedersenCommitment.from(0n, paddingOpening);
    const rangeProofData = new input.zk.BatchedRangeProofU128Data(
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
        getConfidentialTransferInstructionWithAuditorCiphertexts({
            sourceToken: input.sourceToken,
            mint: input.mint,
            destinationToken: input.destinationToken,
            authority: input.authority,
            newSourceDecryptableAvailableBalance: input.aesKey.encrypt(newAvailableBalance).toBytes(),
            transferAmountAuditorCiphertextLo,
            transferAmountAuditorCiphertextHi,
            equalityProofLocation: { contextStateAccount: equalityProofPlan.address },
            ciphertextValidityProofLocation: { contextStateAccount: ciphertextValidityProofPlan.address },
            rangeProofLocation: { contextStateAccount: rangeProofPlan.address },
            multiSigners: input.multiSigners,
            programAddress: input.programAddress,
        }),
        parallelInstructionPlan([
            equalityProofPlan.cleanup,
            ciphertextValidityProofPlan.cleanup,
            rangeProofPlan.cleanup,
        ]),
    ]);
}
