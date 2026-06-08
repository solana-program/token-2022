import {
    closeContextStateProof,
    verifyBatchedGroupedCiphertext3HandlesValidity,
    verifyBatchedRangeProofU128,
    verifyCiphertextCommitmentEquality,
} from '@solana-program/zk-elgamal-proof';
import {
    Address,
    Instruction,
    TransactionSigner,
    generateKeyPairSigner,
    getAddressEncoder,
    isSome,
    parallelInstructionPlan,
    sequentialInstructionPlan,
    type GetMinimumBalanceForRentExemptionApi,
    type InstructionPlan,
    type ReadonlyUint8Array,
    type Rpc,
} from '@solana/kit';
import {
    Extension,
    Mint,
    TOKEN_2022_PROGRAM_ADDRESS,
    Token,
    getApplyConfidentialPendingBurnInstruction,
    getConfidentialBurnInstruction,
    getConfidentialMintInstruction,
    getPermissionedConfidentialBurnInstruction,
    getUpdateConfidentialMintBurnDecryptableSupplyInstruction,
} from './generated';
import {
    AeCiphertext,
    AeKey,
    BatchedGroupedCiphertext3HandlesValidityProofData,
    BatchedRangeProofU128Data,
    CiphertextCommitmentEqualityProofData,
    ElGamalCiphertext,
    ElGamalKeypair,
    ElGamalPubkey,
    ElGamalSecretKey,
    GroupedElGamalCiphertext3Handles,
    PedersenCommitment,
    PedersenOpening,
} from '@solana/zk-sdk/bundler';
import {
    addWithLoHiCiphertexts,
    extractCiphertextFromGroupedBytes,
    subtractWithLoHiCiphertexts,
} from './confidentialTransferArithmetic';

const AMOUNT_LO_BIT_LENGTH = 16n;
const AMOUNT_HI_BIT_LENGTH = 32n;
const CONFIDENTIAL_MINT_BURN_AMOUNT_BIT_LENGTH = 48n;
const BALANCE_BIT_LENGTH = 64;
const RANGE_PROOF_PADDING_BIT_LENGTH = 16;

type ConfidentialMintBurnExtension = Extract<Extension, { __kind: 'ConfidentialMintBurn' }>;
type ConfidentialTransferAccountExtension = Extract<Extension, { __kind: 'ConfidentialTransferAccount' }>;
type ConfidentialTransferMintExtension = Extract<Extension, { __kind: 'ConfidentialTransferMint' }>;

type ContextStateProofMode = {
    /**
     * The strategy used to provide zero-knowledge proofs to the program.
     *
     * Currently, only `context-state` is supported, where each proof is verified
     * into a dedicated context-state account before the instruction is executed.
     * Additional modes such as `instruction-data` may be supported in the future.
     */
    proofMode?: 'context-state';
    payer: TransactionSigner;
    rpc: Rpc<GetMinimumBalanceForRentExemptionApi>;
};

type GetConfidentialMintInstructionPlanBaseInput = {
    token: Address;
    mint: Address;
    mintAccount: Mint;
    destinationTokenAccount: Token;
    authority: Address | TransactionSigner;
    amount: number | bigint;
    supplyElgamalKeypair: ElGamalKeypair;
    supplyAesKey: AeKey;
    multiSigners?: Array<TransactionSigner>;
    programAddress?: Address;
};

export type GetConfidentialMintInstructionPlanInput = GetConfidentialMintInstructionPlanBaseInput &
    ContextStateProofMode;

type GetConfidentialBurnInstructionPlanBaseInput = {
    token: Address;
    mint: Address;
    mintAccount: Mint;
    tokenAccount: Token;
    authority: Address | TransactionSigner;
    amount: number | bigint;
    sourceElgamalKeypair: ElGamalKeypair;
    sourceAesKey: AeKey;
    multiSigners?: Array<TransactionSigner>;
    programAddress?: Address;
};

export type GetConfidentialBurnInstructionPlanInput = GetConfidentialBurnInstructionPlanBaseInput &
    ContextStateProofMode;

export type GetPermissionedConfidentialBurnInstructionPlanInput = GetConfidentialBurnInstructionPlanInput & {
    permissionedBurnAuthority: TransactionSigner;
};

export type GetApplyConfidentialPendingBurnInstructionPlanInput = {
    mint: Address;
    mintAccount: Mint;
    authority: Address | TransactionSigner;
    supplyElgamalSecretKey: ElGamalSecretKey;
    supplyAesKey: AeKey;
    multiSigners?: Array<TransactionSigner>;
    programAddress?: Address;
};

function getTokenProgramAddress(programAddress?: Address) {
    return programAddress ?? TOKEN_2022_PROGRAM_ADDRESS;
}

function getRequiredConfidentialMintBurnExtension(mintAccount: Mint): ConfidentialMintBurnExtension {
    if (!isSome(mintAccount.extensions)) {
        throw new Error('Mint account is missing extensions.');
    }

    const extension = mintAccount.extensions.value.find(candidate => candidate.__kind === 'ConfidentialMintBurn') as
        | ConfidentialMintBurnExtension
        | undefined;
    if (!extension) {
        throw new Error('Mint account is missing the ConfidentialMintBurn extension.');
    }

    return extension;
}

function getRequiredConfidentialTransferMintExtension(mintAccount: Mint): ConfidentialTransferMintExtension {
    if (!isSome(mintAccount.extensions)) {
        throw new Error('Mint account is missing extensions.');
    }

    const extension = mintAccount.extensions.value.find(
        candidate => candidate.__kind === 'ConfidentialTransferMint',
    ) as ConfidentialTransferMintExtension | undefined;
    if (!extension) {
        throw new Error('Mint account is missing the ConfidentialTransferMint extension.');
    }

    return extension;
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

function getAuditorElGamalPubkey(mintAccount: Mint) {
    const auditorElGamalPubkey = getRequiredConfidentialTransferMintExtension(mintAccount).auditorElgamalPubkey;
    return isSome(auditorElGamalPubkey)
        ? getElGamalPubkeyFromAddress(auditorElGamalPubkey.value)
        : ElGamalPubkey.fromBytes(new Uint8Array(32));
}

function splitAmount(amount: bigint, bitLength: bigint): [bigint, bigint] {
    const mask = (1n << bitLength) - 1n;
    return [amount & mask, amount >> bitLength];
}

function assertAmountFitsBitLength(amount: bigint, bitLength: bigint): void {
    if (amount < 0n) {
        throw new Error('Amount must be non-negative.');
    }
    if (amount >= 1n << bitLength) {
        throw new Error(`Amount must fit within ${bitLength} bits.`);
    }
}

function computeNewAmount(currentAmount: bigint, amount: bigint): bigint {
    if (amount > currentAmount) {
        throw new Error('Insufficient funds.');
    }
    return currentAmount - amount;
}

function bytesEqual(left: ReadonlyUint8Array, right: ReadonlyUint8Array): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertSupplyElGamalKeypairMatchesMint(
    supplyElgamalKeypair: ElGamalKeypair,
    mintBurnExtension: ConfidentialMintBurnExtension,
): void {
    if (
        !bytesEqual(
            supplyElgamalKeypair.pubkey().toBytes(),
            getAddressEncoder().encode(mintBurnExtension.supplyElgamalPubkey),
        )
    ) {
        throw new Error('Supply ElGamal keypair does not match mint.');
    }
}

function assertSourceElGamalKeypairMatchesToken(
    sourceElgamalKeypair: ElGamalKeypair,
    account: ConfidentialTransferAccountExtension,
): void {
    if (!bytesEqual(sourceElgamalKeypair.pubkey().toBytes(), getAddressEncoder().encode(account.elgamalPubkey))) {
        throw new Error('Source ElGamal keypair does not match token account.');
    }
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
        // in one transaction for small proofs but exceed the size limit for
        // larger proofs. A transaction planner decides how to pack them; the
        // verify only needs the account to exist, which is true once
        // create-account is confirmed.
        setup: sequentialInstructionPlan(setupInstructions),
        cleanup: closeContextStateProof({
            contextState: contextAccount.address,
            authority: contextStateAuthority,
            destination: payer.address,
        }),
    };
}

function buildRangeProofData(
    remainingOrSupplyCommitment: PedersenCommitment,
    remainingOrSupplyAmount: bigint,
    remainingOrSupplyOpening: PedersenOpening,
    groupedCiphertextLoBytes: ReadonlyUint8Array,
    groupedCiphertextHiBytes: ReadonlyUint8Array,
    amountLo: bigint,
    amountHi: bigint,
    openingLo: PedersenOpening,
    openingHi: PedersenOpening,
) {
    const commitmentLo = PedersenCommitment.fromBytes(groupedCiphertextLoBytes.slice(0, 32));
    const commitmentHi = PedersenCommitment.fromBytes(groupedCiphertextHiBytes.slice(0, 32));
    const paddingOpening = new PedersenOpening();
    const paddingCommitment = PedersenCommitment.from(0n, paddingOpening);
    return new BatchedRangeProofU128Data(
        [remainingOrSupplyCommitment, commitmentLo, commitmentHi, paddingCommitment],
        new BigUint64Array([remainingOrSupplyAmount, amountLo, amountHi, 0n]),
        Uint8Array.from([
            BALANCE_BIT_LENGTH,
            Number(AMOUNT_LO_BIT_LENGTH),
            Number(AMOUNT_HI_BIT_LENGTH),
            RANGE_PROOF_PADDING_BIT_LENGTH,
        ]),
        [remainingOrSupplyOpening, openingLo, openingHi, paddingOpening],
    );
}

async function buildMintBurnProofPlans(
    input: ContextStateProofMode,
    equalityProofData: CiphertextCommitmentEqualityProofData,
    ciphertextValidityProofData: BatchedGroupedCiphertext3HandlesValidityProofData,
    rangeProofData: BatchedRangeProofU128Data,
) {
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

    return { equalityProofPlan, ciphertextValidityProofPlan, rangeProofPlan };
}

/**
 * Returns an instruction plan that confidentially mints tokens into a token
 * account's pending confidential balance and updates the mint's confidential
 * supply. Generates and verifies the equality, grouped-ciphertext validity,
 * and batched range proofs via context-state accounts.
 */
export async function getConfidentialMintInstructionPlan(
    input: GetConfidentialMintInstructionPlanInput,
): Promise<InstructionPlan> {
    const amount = BigInt(input.amount);
    assertAmountFitsBitLength(amount, CONFIDENTIAL_MINT_BURN_AMOUNT_BIT_LENGTH);

    const mintBurnExtension = getRequiredConfidentialMintBurnExtension(input.mintAccount);
    assertSupplyElGamalKeypairMatchesMint(input.supplyElgamalKeypair, mintBurnExtension);
    const destinationAccount = getRequiredConfidentialTransferAccountExtension(input.destinationTokenAccount);
    const [amountLo, amountHi] = splitAmount(amount, AMOUNT_LO_BIT_LENGTH);

    const supplyPubkey = input.supplyElgamalKeypair.pubkey();
    const destinationPubkey = getElGamalPubkeyFromAddress(destinationAccount.elgamalPubkey);
    const auditorPubkey = getAuditorElGamalPubkey(input.mintAccount);

    const openingLo = new PedersenOpening();
    const openingHi = new PedersenOpening();
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
    const mintAmountSupplyCiphertextLo = extractCiphertextFromGroupedBytes(groupedCiphertextLoBytes, 1);
    const mintAmountSupplyCiphertextHi = extractCiphertextFromGroupedBytes(groupedCiphertextHiBytes, 1);
    const mintAmountAuditorCiphertextLo = extractCiphertextFromGroupedBytes(groupedCiphertextLoBytes, 2);
    const mintAmountAuditorCiphertextHi = extractCiphertextFromGroupedBytes(groupedCiphertextHiBytes, 2);

    const currentSupply = input.supplyAesKey.decrypt(parseAeCiphertext(mintBurnExtension.decryptableSupply));
    const newSupply = currentSupply + amount;
    assertAmountFitsBitLength(newSupply, BigInt(BALANCE_BIT_LENGTH));

    const newSupplyOpening = new PedersenOpening();
    const newSupplyCommitment = PedersenCommitment.from(newSupply, newSupplyOpening);
    const newSupplyCiphertext = parseElGamalCiphertext(
        addWithLoHiCiphertexts(
            mintBurnExtension.confidentialSupply,
            mintAmountSupplyCiphertextLo,
            mintAmountSupplyCiphertextHi,
            AMOUNT_LO_BIT_LENGTH,
        ),
    );

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
    const rangeProofData = buildRangeProofData(
        newSupplyCommitment,
        newSupply,
        newSupplyOpening,
        groupedCiphertextLoBytes,
        groupedCiphertextHiBytes,
        amountLo,
        amountHi,
        openingLo,
        openingHi,
    );

    const { equalityProofPlan, ciphertextValidityProofPlan, rangeProofPlan } = await buildMintBurnProofPlans(
        input,
        equalityProofData,
        ciphertextValidityProofData,
        rangeProofData,
    );

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

async function getConfidentialBurnInstructionPlanInternal(
    input: GetConfidentialBurnInstructionPlanInput,
    permissionedBurnAuthority?: TransactionSigner,
): Promise<InstructionPlan> {
    const amount = BigInt(input.amount);
    assertAmountFitsBitLength(amount, CONFIDENTIAL_MINT_BURN_AMOUNT_BIT_LENGTH);

    const mintBurnExtension = getRequiredConfidentialMintBurnExtension(input.mintAccount);
    const sourceAccount = getRequiredConfidentialTransferAccountExtension(input.tokenAccount);
    assertSourceElGamalKeypairMatchesToken(input.sourceElgamalKeypair, sourceAccount);
    const [amountLo, amountHi] = splitAmount(amount, AMOUNT_LO_BIT_LENGTH);

    const sourcePubkey = input.sourceElgamalKeypair.pubkey();
    const supplyPubkey = getElGamalPubkeyFromAddress(mintBurnExtension.supplyElgamalPubkey);
    const auditorPubkey = getAuditorElGamalPubkey(input.mintAccount);

    const openingLo = new PedersenOpening();
    const openingHi = new PedersenOpening();
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
    const burnAmountSourceCiphertextLo = extractCiphertextFromGroupedBytes(groupedCiphertextLoBytes, 0);
    const burnAmountSourceCiphertextHi = extractCiphertextFromGroupedBytes(groupedCiphertextHiBytes, 0);
    const burnAmountAuditorCiphertextLo = extractCiphertextFromGroupedBytes(groupedCiphertextLoBytes, 2);
    const burnAmountAuditorCiphertextHi = extractCiphertextFromGroupedBytes(groupedCiphertextHiBytes, 2);

    const currentAvailableBalance = input.sourceAesKey.decrypt(
        parseAeCiphertext(sourceAccount.decryptableAvailableBalance),
    );
    const newAvailableBalance = computeNewAmount(currentAvailableBalance, amount);
    const newAvailableBalanceOpening = new PedersenOpening();
    const newAvailableBalanceCommitment = PedersenCommitment.from(newAvailableBalance, newAvailableBalanceOpening);
    const newAvailableBalanceCiphertext = parseElGamalCiphertext(
        subtractWithLoHiCiphertexts(
            sourceAccount.availableBalance,
            burnAmountSourceCiphertextLo,
            burnAmountSourceCiphertextHi,
            AMOUNT_LO_BIT_LENGTH,
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
        supplyPubkey,
        auditorPubkey,
        groupedCiphertextLo,
        groupedCiphertextHi,
        amountLo,
        amountHi,
        openingLo,
        openingHi,
    );
    const rangeProofData = buildRangeProofData(
        newAvailableBalanceCommitment,
        newAvailableBalance,
        newAvailableBalanceOpening,
        groupedCiphertextLoBytes,
        groupedCiphertextHiBytes,
        amountLo,
        amountHi,
        openingLo,
        openingHi,
    );

    const { equalityProofPlan, ciphertextValidityProofPlan, rangeProofPlan } = await buildMintBurnProofPlans(
        input,
        equalityProofData,
        ciphertextValidityProofData,
        rangeProofData,
    );

    const instructionInput = {
        token: input.token,
        mint: input.mint,
        equalityRecord: equalityProofPlan.address,
        ciphertextValidityRecord: ciphertextValidityProofPlan.address,
        rangeRecord: rangeProofPlan.address,
        authority: input.authority,
        newDecryptableAvailableBalance: input.sourceAesKey.encrypt(newAvailableBalance).toBytes(),
        burnAmountAuditorCiphertextLo,
        burnAmountAuditorCiphertextHi,
        equalityProofInstructionOffset: 0,
        ciphertextValidityProofInstructionOffset: 0,
        rangeProofInstructionOffset: 0,
        multiSigners: input.multiSigners,
    };
    const burnInstruction = permissionedBurnAuthority
        ? getPermissionedConfidentialBurnInstruction(
              { ...instructionInput, permissionedBurnAuthority },
              { programAddress: getTokenProgramAddress(input.programAddress) },
          )
        : getConfidentialBurnInstruction(instructionInput, {
              programAddress: getTokenProgramAddress(input.programAddress),
          });

    return sequentialInstructionPlan([
        parallelInstructionPlan([equalityProofPlan.setup, ciphertextValidityProofPlan.setup, rangeProofPlan.setup]),
        burnInstruction,
        parallelInstructionPlan([
            equalityProofPlan.cleanup,
            ciphertextValidityProofPlan.cleanup,
            rangeProofPlan.cleanup,
        ]),
    ]);
}

/**
 * Returns an instruction plan that confidentially burns tokens from a token
 * account's available confidential balance and records the encrypted burn in
 * the mint's pending burn accumulator.
 */
export async function getConfidentialBurnInstructionPlan(
    input: GetConfidentialBurnInstructionPlanInput,
): Promise<InstructionPlan> {
    return await getConfidentialBurnInstructionPlanInternal(input);
}

/**
 * Returns an instruction plan for the permissioned confidential burn variant.
 * It builds the same proofs as `getConfidentialBurnInstructionPlan` and also
 * includes the configured permissioned burn authority signer.
 */
export async function getPermissionedConfidentialBurnInstructionPlan(
    input: GetPermissionedConfidentialBurnInstructionPlanInput,
): Promise<InstructionPlan> {
    return await getConfidentialBurnInstructionPlanInternal(input, input.permissionedBurnAuthority);
}

/**
 * Returns an instruction plan that applies the mint's pending confidential
 * burn amount to confidential supply and updates the decryptable supply to
 * match the resulting ciphertext.
 */
export function getApplyConfidentialPendingBurnInstructionPlan(
    input: GetApplyConfidentialPendingBurnInstructionPlanInput,
): InstructionPlan {
    const mintBurnExtension = getRequiredConfidentialMintBurnExtension(input.mintAccount);
    const currentSupply = input.supplyAesKey.decrypt(parseAeCiphertext(mintBurnExtension.decryptableSupply));
    const pendingBurn = input.supplyElgamalSecretKey.decrypt(parseElGamalCiphertext(mintBurnExtension.pendingBurn));
    const newSupply = computeNewAmount(currentSupply, pendingBurn);
    const programAddress = getTokenProgramAddress(input.programAddress);

    return sequentialInstructionPlan([
        getApplyConfidentialPendingBurnInstruction(
            {
                mint: input.mint,
                authority: input.authority,
                multiSigners: input.multiSigners,
            },
            { programAddress },
        ),
        getUpdateConfidentialMintBurnDecryptableSupplyInstruction(
            {
                mint: input.mint,
                authority: input.authority,
                newDecryptableSupply: input.supplyAesKey.encrypt(newSupply).toBytes(),
                multiSigners: input.multiSigners,
            },
            { programAddress },
        ),
    ]);
}
