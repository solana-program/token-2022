import { getCreateAccountInstruction } from '@solana-program/system';
import {
    AccountRole,
    Address,
    Instruction,
    TransactionSigner,
    appendTransactionMessageInstructions,
    createTransactionMessage,
    generateKeyPairSigner,
    getAddressEncoder,
    getI8Encoder,
    getStructEncoder,
    getTransactionMessageSize,
    getU64Encoder,
    getU8Encoder,
    isSome,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    type AccountMeta,
    type ReadonlyUint8Array,
} from '@solana/kit';
import {
    ExtensionType,
    Extension,
    TOKEN_2022_PROGRAM_ADDRESS,
    Token,
    findAssociatedTokenPda,
    getApplyConfidentialPendingBalanceInstruction,
    getCreateAssociatedTokenIdempotentInstruction,
    getDecryptableBalanceEncoder,
    getEncryptedBalanceEncoder,
    getReallocateInstruction,
} from './generated';
import { expectAddress, isTransactionSigner } from './generated/shared';
import {
    extractCiphertextFromGroupedBytes,
    subtractAmountFromCiphertext,
    subtractWithLoHiCiphertexts,
} from './confidentialTransferArithmetic';

const ADDRESS_ENCODER = getAddressEncoder();

const DEFAULT_MAXIMUM_PENDING_BALANCE_CREDIT_COUNTER = 1n << 16n;
const PENDING_BALANCE_LO_BIT_LENGTH = 16n;
const TRANSFER_AMOUNT_LO_BIT_LENGTH = 16n;
const TRANSFER_AMOUNT_HI_BIT_LENGTH = 32n;
const REMAINING_BALANCE_BIT_LENGTH = 64;
const RANGE_PROOF_PADDING_BIT_LENGTH = 16;

const INSTRUCTIONS_SYSVAR_ADDRESS =
    'Sysvar1nstructions1111111111111111111111111' as Address<'Sysvar1nstructions1111111111111111111111111'>;
const ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS =
    'ZkE1Gama1Proof11111111111111111111111111111' as Address<'ZkE1Gama1Proof11111111111111111111111111111'>;
const DUMMY_BLOCKHASH = '11111111111111111111111111111111' as Parameters<
    typeof setTransactionMessageLifetimeUsingBlockhash
>[0]['blockhash'];
const TRANSACTION_SIZE_LIMIT = 1232;

const VERIFY_CIPHERTEXT_COMMITMENT_EQUALITY_INSTRUCTION = 3;
const VERIFY_PUBKEY_VALIDITY_INSTRUCTION = 4;
const VERIFY_BATCHED_RANGE_PROOF_U64_INSTRUCTION = 6;
const VERIFY_BATCHED_RANGE_PROOF_U128_INSTRUCTION = 7;
const VERIFY_BATCHED_GROUPED_CIPHERTEXT_3_HANDLES_VALIDITY_INSTRUCTION = 12;

type BytesLike = { toBytes(): Uint8Array };
type GetMinimumBalanceForRentExemptionRpc = {
    getMinimumBalanceForRentExemption(space: bigint): {
        send(): Promise<bigint>;
    };
};

export type ConfidentialTransferZkAeCiphertext = BytesLike;
export type ConfidentialTransferZkElGamalCiphertext = BytesLike;
export type ConfidentialTransferZkPedersenCommitment = BytesLike;
export type ConfidentialTransferZkPedersenOpening = object;
export type ConfidentialTransferZkGroupedElGamalCiphertext3Handles = BytesLike;
export type ConfidentialTransferZkProofContext = BytesLike;
export type ConfidentialTransferZkProofData = BytesLike & {
    context(): ConfidentialTransferZkProofContext;
};

export type ConfidentialTransferZkAeKey = {
    decrypt(ciphertext: ConfidentialTransferZkAeCiphertext): bigint;
    encrypt(amount: bigint): ConfidentialTransferZkAeCiphertext;
};

export type ConfidentialTransferZkElGamalSecretKey = {
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
    rpc: GetMinimumBalanceForRentExemptionRpc;
};

export type ConfidentialTransferInstructionPlan = {
    setupInstructions: Instruction[][];
    instructions: Instruction[];
    cleanupInstructions: Instruction[][];
};

export type GetCreateConfidentialTransferAccountInstructionsInput = {
    payer: TransactionSigner;
    owner: Address | TransactionSigner;
    mint: Address;
    token?: Address;
    authority?: Address | TransactionSigner;
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
    | { destinationElgamalPubkey: Address; destinationTokenAccount?: undefined }
);

export type GetConfidentialTransferInstructionsInput = GetConfidentialTransferInstructionsBaseInput &
    ContextStateProofMode;

const CONFIDENTIAL_TRANSFER_INSTRUCTION_DATA_ENCODER = getStructEncoder([
    ['discriminator', getU8Encoder()],
    ['confidentialTransferDiscriminator', getU8Encoder()],
    ['newSourceDecryptableAvailableBalance', getDecryptableBalanceEncoder()],
    ['transferAmountAuditorCiphertextLo', getEncryptedBalanceEncoder()],
    ['transferAmountAuditorCiphertextHi', getEncryptedBalanceEncoder()],
    ['equalityProofInstructionOffset', getI8Encoder()],
    ['ciphertextValidityProofInstructionOffset', getI8Encoder()],
    ['rangeProofInstructionOffset', getI8Encoder()],
]);

const CONFIGURE_CONFIDENTIAL_TRANSFER_ACCOUNT_INSTRUCTION_DATA_ENCODER = getStructEncoder([
    ['discriminator', getU8Encoder()],
    ['confidentialTransferDiscriminator', getU8Encoder()],
    ['decryptableZeroBalance', getDecryptableBalanceEncoder()],
    ['maximumPendingBalanceCreditCounter', getU64Encoder()],
    ['proofInstructionOffset', getI8Encoder()],
]);

const CONFIDENTIAL_WITHDRAW_INSTRUCTION_DATA_ENCODER = getStructEncoder([
    ['discriminator', getU8Encoder()],
    ['confidentialTransferDiscriminator', getU8Encoder()],
    ['amount', getU64Encoder()],
    ['decimals', getU8Encoder()],
    ['newDecryptableAvailableBalance', getDecryptableBalanceEncoder()],
    ['equalityProofInstructionOffset', getI8Encoder()],
    ['rangeProofInstructionOffset', getI8Encoder()],
]);

function getTokenProgramAddress(programAddress?: Address) {
    return programAddress ?? TOKEN_2022_PROGRAM_ADDRESS;
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
    return zk.ElGamalPubkey.fromBytes(new Uint8Array(ADDRESS_ENCODER.encode(value)));
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

function getVerifyProofInstruction(
    instructionDiscriminator: number,
    proofData: ReadonlyUint8Array,
    contextStateAccount?: Address,
    contextStateAuthority?: Address,
): Instruction {
    const data = new Uint8Array(1 + proofData.length);
    data[0] = instructionDiscriminator;
    data.set(new Uint8Array(proofData), 1);

    return Object.freeze({
        accounts:
            contextStateAccount && contextStateAuthority
                ? [
                      { address: contextStateAccount, role: AccountRole.WRITABLE },
                      { address: contextStateAuthority, role: AccountRole.READONLY },
                  ]
                : [],
        data,
        programAddress: ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
    });
}

function getCloseContextStateInstruction(input: {
    contextStateAccount: Address;
    lamportDestinationAccount: Address;
    contextStateAuthority: Address | TransactionSigner;
}) {
    return Object.freeze({
        accounts: [
            { address: input.contextStateAccount, role: AccountRole.WRITABLE },
            { address: input.lamportDestinationAccount, role: AccountRole.WRITABLE },
            getReadonlyAuthorityAccountMeta(input.contextStateAuthority),
        ],
        data: Uint8Array.from([0]),
        programAddress: ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
    } as Instruction);
}

function canFitInSingleVersionZeroTransaction(payer: TransactionSigner, instructions: Instruction[]) {
    const transactionMessage = appendTransactionMessageInstructions(
        instructions,
        setTransactionMessageLifetimeUsingBlockhash(
            {
                blockhash: DUMMY_BLOCKHASH,
                lastValidBlockHeight: 0n,
            },
            setTransactionMessageFeePayerSigner(payer, createTransactionMessage({ version: 0 })),
        ),
    );
    return getTransactionMessageSize(transactionMessage) <= TRANSACTION_SIZE_LIMIT;
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
    if (expectAddress(owner) !== expectAddress(authority)) {
        throw new Error(
            'This helper is scoped to the token-account owner. For the ATA convenience flow, authority must match owner.',
        );
    }
}

async function createProofContextStateAccountInstructions(input: {
    payer: TransactionSigner;
    rpc: GetMinimumBalanceForRentExemptionRpc;
    contextStateAuthority: TransactionSigner;
    lamportDestinationAccount: Address;
    instructionDiscriminator: number;
    proofData: ConfidentialTransferZkProofData;
}) {
    const contextStateAccount = await generateKeyPairSigner();
    const space = 33n + BigInt(input.proofData.context().toBytes().length);
    const lamports = await input.rpc.getMinimumBalanceForRentExemption(space).send();
    const createAccountInstruction = getCreateAccountInstruction({
        payer: input.payer,
        newAccount: contextStateAccount,
        lamports,
        space,
        programAddress: ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
    });
    const verifyProofInstruction = getVerifyProofInstruction(
        input.instructionDiscriminator,
        input.proofData.toBytes(),
        contextStateAccount.address,
        input.contextStateAuthority.address,
    );
    const canCombineSetup = canFitInSingleVersionZeroTransaction(input.payer, [
        createAccountInstruction,
        verifyProofInstruction,
    ]);

    return {
        address: contextStateAccount.address,
        setupInstructions: canCombineSetup
            ? ([[createAccountInstruction, verifyProofInstruction]] satisfies Instruction[][])
            : ([[createAccountInstruction], [verifyProofInstruction]] satisfies Instruction[][]),
        cleanupInstructions: [
            [
                getCloseContextStateInstruction({
                    contextStateAccount: contextStateAccount.address,
                    lamportDestinationAccount: input.lamportDestinationAccount,
                    contextStateAuthority: input.contextStateAuthority,
                }),
            ],
        ] satisfies Instruction[][],
    };
}

function getReadonlyAuthorityAccountMeta(authority: Address | TransactionSigner) {
    return Object.freeze({
        address: expectAddress(authority),
        role: isTransactionSigner(authority) ? AccountRole.READONLY_SIGNER : AccountRole.READONLY,
        ...(isTransactionSigner(authority) ? { signer: authority } : {}),
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
        data: CONFIGURE_CONFIDENTIAL_TRANSFER_ACCOUNT_INSTRUCTION_DATA_ENCODER.encode({
            discriminator: 27,
            confidentialTransferDiscriminator: 2,
            decryptableZeroBalance: input.decryptableZeroBalance,
            maximumPendingBalanceCreditCounter: input.maximumPendingBalanceCreditCounter,
            proofInstructionOffset: input.proofInstructionOffset,
        }),
        programAddress: getTokenProgramAddress(input.programAddress),
    } as Instruction);
}

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
        data: CONFIDENTIAL_WITHDRAW_INSTRUCTION_DATA_ENCODER.encode({
            discriminator: 27,
            confidentialTransferDiscriminator: 6,
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
        data: CONFIDENTIAL_TRANSFER_INSTRUCTION_DATA_ENCODER.encode({
            discriminator: 27,
            confidentialTransferDiscriminator: 7,
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

export async function getCreateConfidentialTransferAccountInstructions(
    input: GetCreateConfidentialTransferAccountInstructionsInput,
): Promise<Instruction[]> {
    const programAddress = getTokenProgramAddress(input.programAddress);
    const authority = input.authority ?? input.owner;
    assertCreateHelperOwnerMatchesAuthority(input.owner, authority);

    const ownerAddress = expectAddress(input.owner);
    const token =
        input.token ??
        (
            await findAssociatedTokenPda({
                owner: ownerAddress,
                tokenProgram: programAddress,
                mint: input.mint,
            })
        )[0];

    const createTokenInstruction = getCreateAssociatedTokenIdempotentInstruction({
        ata: token,
        mint: input.mint,
        owner: ownerAddress,
        payer: input.payer,
        tokenProgram: programAddress,
    });
    const pubkeyValidityProofData = new input.zk.PubkeyValidityProofData(input.elgamalKeypair);

    return [
        createTokenInstruction,
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
        getVerifyProofInstruction(VERIFY_PUBKEY_VALIDITY_INSTRUCTION, pubkeyValidityProofData.toBytes()),
    ];
}

export function getApplyConfidentialPendingBalanceInstructionFromToken(
    input: GetApplyConfidentialPendingBalanceInstructionFromTokenInput,
) {
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

export async function getConfidentialWithdrawInstructions(
    input: GetConfidentialWithdrawInstructionsInput,
): Promise<ConfidentialTransferInstructionPlan> {
    assertInstructionDataProofModeIsUnsupported(input as { proofMode?: string });
    const account = getRequiredConfidentialTransferAccountExtension(input.tokenAccount);
    const amount = toBigIntAmount(input.amount);
    const currentAvailableBalance = decryptAvailableBalance(input.zk, account, input.aesKey);
    const newAvailableBalance = currentAvailableBalance - amount;
    if (newAvailableBalance < 0n) {
        throw new Error('Insufficient funds.');
    }

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

    const contextStateAuthority = input.payer;
    const [equalityProofPlan, rangeProofPlan] = await Promise.all([
        createProofContextStateAccountInstructions({
            payer: input.payer,
            rpc: input.rpc,
            contextStateAuthority,
            lamportDestinationAccount: input.payer.address,
            instructionDiscriminator: VERIFY_CIPHERTEXT_COMMITMENT_EQUALITY_INSTRUCTION,
            proofData: equalityProofData,
        }),
        createProofContextStateAccountInstructions({
            payer: input.payer,
            rpc: input.rpc,
            contextStateAuthority,
            lamportDestinationAccount: input.payer.address,
            instructionDiscriminator: VERIFY_BATCHED_RANGE_PROOF_U64_INSTRUCTION,
            proofData: rangeProofData,
        }),
    ]);

    return {
        setupInstructions: [...equalityProofPlan.setupInstructions, ...rangeProofPlan.setupInstructions],
        instructions: [
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
        ],
        cleanupInstructions: [...equalityProofPlan.cleanupInstructions, ...rangeProofPlan.cleanupInstructions],
    };
}

export async function getConfidentialTransferInstructions(
    input: GetConfidentialTransferInstructionsInput,
): Promise<ConfidentialTransferInstructionPlan> {
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

    const currentAvailableBalance = decryptAvailableBalance(input.zk, sourceAccount, input.aesKey);
    const newAvailableBalance = currentAvailableBalance - amount;
    if (newAvailableBalance < 0n) {
        throw new Error('Insufficient funds.');
    }
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

    const contextStateAuthority = input.payer;
    const [equalityProofPlan, ciphertextValidityProofPlan, rangeProofPlan] = await Promise.all([
        createProofContextStateAccountInstructions({
            payer: input.payer,
            rpc: input.rpc,
            contextStateAuthority,
            lamportDestinationAccount: input.payer.address,
            instructionDiscriminator: VERIFY_CIPHERTEXT_COMMITMENT_EQUALITY_INSTRUCTION,
            proofData: equalityProofData,
        }),
        createProofContextStateAccountInstructions({
            payer: input.payer,
            rpc: input.rpc,
            contextStateAuthority,
            lamportDestinationAccount: input.payer.address,
            instructionDiscriminator: VERIFY_BATCHED_GROUPED_CIPHERTEXT_3_HANDLES_VALIDITY_INSTRUCTION,
            proofData: ciphertextValidityProofData,
        }),
        createProofContextStateAccountInstructions({
            payer: input.payer,
            rpc: input.rpc,
            contextStateAuthority,
            lamportDestinationAccount: input.payer.address,
            instructionDiscriminator: VERIFY_BATCHED_RANGE_PROOF_U128_INSTRUCTION,
            proofData: rangeProofData,
        }),
    ]);

    return {
        setupInstructions: [
            ...equalityProofPlan.setupInstructions,
            ...ciphertextValidityProofPlan.setupInstructions,
            ...rangeProofPlan.setupInstructions,
        ],
        instructions: [
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
        ],
        cleanupInstructions: [
            ...equalityProofPlan.cleanupInstructions,
            ...ciphertextValidityProofPlan.cleanupInstructions,
            ...rangeProofPlan.cleanupInstructions,
        ],
    };
}
