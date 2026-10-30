import { ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS, ZkElGamalProofInstruction } from '@solana-program/zk-elgamal-proof';
import {
    Address,
    Instruction,
    InstructionPlan,
    ReadonlyUint8Array,
    SOLANA_ERROR__INSTRUCTION_ERROR__INVALID_INSTRUCTION_DATA,
    SOLANA_ERROR__INSTRUCTION_PLANS__UNEXPECTED_TRANSACTION_PLAN,
    SOLANA_ERROR__TRANSACTION_ERROR__MAX_LOADED_ACCOUNTS_DATA_SIZE_EXCEEDED,
    TransactionSigner,
    getAddressDecoder,
    getSignatureFromTransaction,
    getTransactionSize,
    getTransactionSizeLimit,
    isSignerRole,
    isSolanaError,
    nonDivisibleSequentialInstructionPlan,
    some,
} from '@solana/kit';
import { SYSVAR_INSTRUCTIONS_ADDRESS } from '@solana/sysvars';
import { ElGamalCiphertext, ElGamalKeypair } from '@solana/zk-sdk/bundler';
import { expect, it } from 'vitest';

import {
    AuthorityType,
    TOKEN_2022_PROGRAM_ADDRESS,
    fetchMint,
    fetchToken,
    getConfidentialBurnInstructionDataDecoder,
    getConfidentialMintInstructionDataDecoder,
    getPermissionedConfidentialBurnInstructionDataDecoder,
    getSetAuthorityInstruction,
} from '../../../src';
import {
    decryptConfidentialTransferBalance,
    getApplyConfidentialPendingBalanceInstructionFromToken,
    getConfidentialBurnWithInstructionOffsetProofsInstructionPlan,
    getConfidentialMintWithInstructionOffsetProofsInstructionPlan,
    getPermissionedConfidentialBurnWithInstructionOffsetProofsInstructionPlan,
} from '../../../src/confidential';
import {
    ConfidentialTokenAccount,
    ValidatorClient,
    createConfidentialMintBurnMint,
    createConfidentialTokenAccount,
    createMultisig,
    createValidatorClient,
    fetchDecryptableSupply,
    generateKeyPairSignerWithSol,
    getSingleTransactionContext,
} from '../../_setup';

const DECIMALS = 2;
const MINT_AMOUNT = 500n;
const BURN_AMOUNT = 200n;

// Byte length of each sibling verify instruction's data: a one-byte
// discriminator followed by the proof data.
const EQUALITY_VERIFY_DATA_LENGTH = 1 + 320;
const CIPHERTEXT_VALIDITY_VERIFY_DATA_LENGTH = 1 + 544;
const RANGE_VERIFY_DATA_LENGTH = 1 + 264 + 736;

// The v1 transaction size limit (SIMD-0385). `@solana/kit` does not re-export
// `V1_TRANSACTION_SIZE_LIMIT` from `@solana/transactions`, so it is mirrored here.
const V1_TRANSACTION_SIZE_LIMIT = 4096;

type ProofInstructionOffsets = {
    equalityProofInstructionOffset: number;
    ciphertextValidityProofInstructionOffset: number;
    rangeProofInstructionOffset: number;
};

function getElGamalPubkeyAddress(keypair: ElGamalKeypair) {
    // ElGamal public keys and Solana addresses share the same 32-byte layout,
    // so use the address decoder to thread this key through Address-typed
    // confidential transfer configuration fields.
    return getAddressDecoder().decode(keypair.pubkey().toBytes());
}

// Awaits a promise that must reject and returns the innermost `cause` of its
// error, e.g. the instruction error behind a failed simulation.
async function getRootCauseOfRejection(promise: Promise<unknown>): Promise<unknown> {
    let error = await promise.then(
        () => {
            throw new Error('Expected the promise to reject.');
        },
        (e: unknown) => e,
    );
    while (error instanceof Error && error.cause) {
        error = error.cause;
    }
    return error;
}

// Flattens a non-divisible sequential plan of single instructions.
function getPlanInstructions(plan: InstructionPlan): Instruction[] {
    if (plan.kind !== 'sequential') {
        throw new Error(`Expected a sequential plan, got ${plan.kind}.`);
    }
    expect(plan.divisible).toBe(false);
    return plan.plans.map(child => {
        if (child.kind !== 'single') {
            throw new Error(`Expected a single instruction plan, got ${child.kind}.`);
        }
        return child.instruction;
    });
}

// Asserts the plan is `[op, verifyEquality, verifyCiphertextValidity, verifyRange]`
// with the op reading its proofs at offsets 1, 2, 3 through the instructions
// sysvar, and that the op's accounts are exactly `expectedAccounts` (no
// context-state or record accounts) with each of `expectedSigners` signing.
function expectInstructionOffsetProofsLayout(
    plan: InstructionPlan,
    decodeOffsets: (data: ReadonlyUint8Array) => ProofInstructionOffsets,
    expectedAccounts: Address[],
    expectedSigners: Address[],
): Instruction[] {
    const instructions = getPlanInstructions(plan);
    expect(instructions).toHaveLength(4);
    const [op, ...verifies] = instructions;

    expect(op.programAddress).toBe(TOKEN_2022_PROGRAM_ADDRESS);
    expect(decodeOffsets(op.data!)).toMatchObject({
        equalityProofInstructionOffset: 1,
        ciphertextValidityProofInstructionOffset: 2,
        rangeProofInstructionOffset: 3,
    });
    expect(op.accounts?.map(account => account.address)).toEqual(expectedAccounts);
    const signers = op.accounts?.filter(account => isSignerRole(account.role)).map(account => account.address);
    expect(signers).toEqual(expectedSigners);

    expect(verifies.map(ix => ix.programAddress)).toEqual([
        ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
        ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
        ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
    ]);
    expect(verifies.map(ix => ix.accounts ?? [])).toEqual([[], [], []]);
    expect(verifies.map(ix => ix.data?.[0])).toEqual([
        ZkElGamalProofInstruction.VerifyCiphertextCommitmentEquality,
        ZkElGamalProofInstruction.VerifyBatchedGroupedCiphertext3HandlesValidity,
        ZkElGamalProofInstruction.VerifyBatchedRangeProofU128,
    ]);
    expect(verifies.map(ix => ix.data?.length)).toEqual([
        EQUALITY_VERIFY_DATA_LENGTH,
        CIPHERTEXT_VALIDITY_VERIFY_DATA_LENGTH,
        RANGE_VERIFY_DATA_LENGTH,
    ]);

    return instructions;
}

// Sends a plan that must fit a single v1 transaction, checks its size against
// the v1 limit and reads its consumed compute units back from the validator.
async function sendSingleV1Transaction(client: ValidatorClient, plan: InstructionPlan) {
    const { transaction } = getSingleTransactionContext(await client.sendTransaction(plan));
    // A v1 size limit means the planner produced a v1 transaction.
    expect(getTransactionSizeLimit(transaction)).toBe(V1_TRANSACTION_SIZE_LIMIT);
    const size = getTransactionSize(transaction);
    expect(size).toBeLessThanOrEqual(getTransactionSizeLimit(transaction));

    const confirmed = await client.rpc
        .getTransaction(getSignatureFromTransaction(transaction), {
            commitment: 'confirmed',
            encoding: 'base64',
            maxSupportedTransactionVersion: 1,
        })
        .send();
    const computeUnits = confirmed?.meta?.computeUnitsConsumed;
    expect(computeUnits).toBeDefined();
    expect(computeUnits).toBeLessThan(400_000n);

    return { size, computeUnits };
}

async function applyPendingBalance(input: {
    client: ValidatorClient;
    account: ConfidentialTokenAccount;
    authority: Address | TransactionSigner;
    multiSigners?: TransactionSigner[];
}) {
    const { data: tokenAccount } = await fetchToken(input.client.rpc, input.account.token);
    await input.client.sendTransaction([
        getApplyConfidentialPendingBalanceInstructionFromToken({
            token: input.account.token,
            tokenAccount,
            authority: input.authority,
            multiSigners: input.multiSigners,
            elgamalSecretKey: input.account.elgamalKeypair.secret(),
            aesKey: input.account.aesKey,
        }),
    ]);
}

async function fetchAvailableBalance(client: ValidatorClient, account: ConfidentialTokenAccount) {
    const { data: tokenAccount } = await fetchToken(client.rpc, account.token);
    return decryptConfidentialTransferBalance({
        tokenAccount,
        elgamalSecretKey: account.elgamalKeypair.secret(),
        aesKey: account.aesKey,
    }).availableBalance;
}

it('confidentially mints and burns in single v1 transactions with sibling proof instructions', async () => {
    // Given a v1 client with the default resource-limit estimation, and a
    // mint-burn mint with a confidential token account.
    const client = await createValidatorClient({ version: 1 });
    const payer = client.payer;
    const owner = await generateKeyPairSignerWithSol(client);
    const { mint, mintAuthority, supplyElgamalKeypair, supplyAesKey } = await createConfidentialMintBurnMint({
        client,
        payer,
        decimals: DECIMALS,
    });
    const account = await createConfidentialTokenAccount({ client, payer, owner, mint });

    // When the authority mints with the proofs verified in sibling instructions.
    const [{ data: destinationTokenAccount }, { data: mintAccount }] = await Promise.all([
        fetchToken(client.rpc, account.token),
        fetchMint(client.rpc, mint),
    ]);
    const mintPlan = getConfidentialMintWithInstructionOffsetProofsInstructionPlan({
        token: account.token,
        mint,
        mintAccount,
        destinationTokenAccount,
        authority: mintAuthority,
        amount: MINT_AMOUNT,
        supplyElgamalKeypair,
        supplyAesKey,
    });

    // Then the plan is the mint followed by its three verify instructions.
    expectInstructionOffsetProofsLayout(
        mintPlan,
        data => getConfidentialMintInstructionDataDecoder().decode(data),
        [account.token, mint, SYSVAR_INSTRUCTIONS_ADDRESS, mintAuthority.address],
        [mintAuthority.address],
    );

    // And it lands as a single v1 transaction well under the size limit.
    const mintTransaction = await sendSingleV1Transaction(client, mintPlan);
    expect(mintTransaction.size).toBeLessThan(2600);

    // And the minted amount becomes available once the pending balance is applied,
    // with the decryptable supply re-synced by the mint itself.
    await applyPendingBalance({ client, account, authority: owner });
    expect(await fetchAvailableBalance(client, account)).toBe(MINT_AMOUNT);
    expect(await fetchDecryptableSupply({ client, mint, supplyAesKey })).toBe(MINT_AMOUNT);

    // When the owner burns part of the available balance the same way.
    const [{ data: sourceTokenAccount }, { data: mintForBurn }] = await Promise.all([
        fetchToken(client.rpc, account.token),
        fetchMint(client.rpc, mint),
    ]);
    const burnPlan = getConfidentialBurnWithInstructionOffsetProofsInstructionPlan({
        token: account.token,
        mint,
        mintAccount: mintForBurn,
        sourceTokenAccount,
        authority: owner,
        amount: BURN_AMOUNT,
        sourceElgamalKeypair: account.elgamalKeypair,
        aesKey: account.aesKey,
    });
    expectInstructionOffsetProofsLayout(
        burnPlan,
        data => getConfidentialBurnInstructionDataDecoder().decode(data),
        [account.token, mint, SYSVAR_INSTRUCTIONS_ADDRESS, owner.address],
        [owner.address],
    );
    const burnTransaction = await sendSingleV1Transaction(client, burnPlan);
    expect(burnTransaction.size).toBeLessThan(2600);

    // Then the available balance drops by the burnt amount.
    expect(await fetchAvailableBalance(client, account)).toBe(MINT_AMOUNT - BURN_AMOUNT);
});

it('resolves the auditor key from the mint account for sibling-proof mints and burns', async () => {
    // Given a mint-burn mint that configures an auditor ElGamal key.
    const client = await createValidatorClient({ version: 1 });
    const payer = client.payer;
    const owner = await generateKeyPairSignerWithSol(client);
    const auditorElgamalKeypair = new ElGamalKeypair();
    const { mint, mintAuthority, supplyElgamalKeypair, supplyAesKey } = await createConfidentialMintBurnMint({
        client,
        payer,
        decimals: DECIMALS,
        auditorElgamalPubkey: getElGamalPubkeyAddress(auditorElgamalKeypair),
    });
    const account = await createConfidentialTokenAccount({ client, payer, owner, mint });

    // When the authority mints without passing `auditorElgamalPubkey`.
    const [{ data: destinationTokenAccount }, { data: mintAccount }] = await Promise.all([
        fetchToken(client.rpc, account.token),
        fetchMint(client.rpc, mint),
    ]);
    const mintPlan = getConfidentialMintWithInstructionOffsetProofsInstructionPlan({
        token: account.token,
        mint,
        mintAccount,
        destinationTokenAccount,
        authority: mintAuthority,
        amount: MINT_AMOUNT,
        supplyElgamalKeypair,
        supplyAesKey,
    });

    // Then the auditor ciphertexts decrypt under the mint's auditor key.
    const [mintInstruction] = getPlanInstructions(mintPlan);
    const mintData = getConfidentialMintInstructionDataDecoder().decode(mintInstruction.data!);
    const auditorSecret = auditorElgamalKeypair.secret();
    const decryptAuditorCiphertext = (bytes: ReadonlyUint8Array) =>
        auditorSecret.decrypt(ElGamalCiphertext.fromBytes(new Uint8Array(bytes))!);
    expect(decryptAuditorCiphertext(mintData.mintAmountAuditorCiphertextLo)).toBe(MINT_AMOUNT & 0xffffn);
    expect(decryptAuditorCiphertext(mintData.mintAmountAuditorCiphertextHi)).toBe(MINT_AMOUNT >> 16n);

    // And the program accepts the proofs against the mint's auditor key.
    await sendSingleV1Transaction(client, mintPlan);
    await applyPendingBalance({ client, account, authority: owner });

    // And the same holds for a burn.
    const [{ data: sourceTokenAccount }, { data: mintForBurn }] = await Promise.all([
        fetchToken(client.rpc, account.token),
        fetchMint(client.rpc, mint),
    ]);
    await sendSingleV1Transaction(
        client,
        getConfidentialBurnWithInstructionOffsetProofsInstructionPlan({
            token: account.token,
            mint,
            mintAccount: mintForBurn,
            sourceTokenAccount,
            authority: owner,
            amount: BURN_AMOUNT,
            sourceElgamalKeypair: account.elgamalKeypair,
            aesKey: account.aesKey,
        }),
    );
    expect(await fetchAvailableBalance(client, account)).toBe(MINT_AMOUNT - BURN_AMOUNT);
});

it('confidentially burns via the permissioned variant with sibling proof instructions', async () => {
    // Given a mint-burn mint that also carries the PermissionedBurn extension.
    const client = await createValidatorClient({ version: 1 });
    const payer = client.payer;
    const owner = await generateKeyPairSignerWithSol(client);
    const permissionedBurnAuthority = await generateKeyPairSignerWithSol(client);
    const { mint, mintAuthority, supplyElgamalKeypair, supplyAesKey } = await createConfidentialMintBurnMint({
        client,
        payer,
        decimals: DECIMALS,
        permissionedBurnAuthority,
    });
    const account = await createConfidentialTokenAccount({ client, payer, owner, mint });

    const [{ data: destinationTokenAccount }, { data: mintAccount }] = await Promise.all([
        fetchToken(client.rpc, account.token),
        fetchMint(client.rpc, mint),
    ]);
    await sendSingleV1Transaction(
        client,
        getConfidentialMintWithInstructionOffsetProofsInstructionPlan({
            token: account.token,
            mint,
            mintAccount,
            destinationTokenAccount,
            authority: mintAuthority,
            amount: MINT_AMOUNT,
            supplyElgamalKeypair,
            supplyAesKey,
        }),
    );
    await applyPendingBalance({ client, account, authority: owner });

    // When the owner burns, co-signed by the permissioned burn authority.
    const [{ data: sourceTokenAccount }, { data: mintForBurn }] = await Promise.all([
        fetchToken(client.rpc, account.token),
        fetchMint(client.rpc, mint),
    ]);
    const burnPlan = getPermissionedConfidentialBurnWithInstructionOffsetProofsInstructionPlan({
        token: account.token,
        mint,
        mintAccount: mintForBurn,
        sourceTokenAccount,
        authority: owner,
        permissionedBurnAuthority,
        amount: BURN_AMOUNT,
        sourceElgamalKeypair: account.elgamalKeypair,
        aesKey: account.aesKey,
    });
    expectInstructionOffsetProofsLayout(
        burnPlan,
        data => getPermissionedConfidentialBurnInstructionDataDecoder().decode(data),
        [account.token, mint, SYSVAR_INSTRUCTIONS_ADDRESS, permissionedBurnAuthority.address, owner.address],
        [permissionedBurnAuthority.address, owner.address],
    );
    await sendSingleV1Transaction(client, burnPlan);

    // Then the available balance drops by the burnt amount.
    expect(await fetchAvailableBalance(client, account)).toBe(MINT_AMOUNT - BURN_AMOUNT);
});

it('mints with a multisig mint authority and burns from a multisig-owned account', async () => {
    // Given a 2-of-2 multisig that is both the mint authority and the owner of
    // the confidential token account.
    const client = await createValidatorClient({ version: 1 });
    const payer = client.payer;
    const [signerA, signerB] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSignerWithSol(client),
    ]);
    const multiSigners = [signerA, signerB];
    const { mint, mintAuthority, supplyElgamalKeypair, supplyAesKey } = await createConfidentialMintBurnMint({
        client,
        payer,
        decimals: DECIMALS,
    });
    const multisig = await createMultisig({ client, payer, signers: multiSigners });
    await client.sendTransaction([
        getSetAuthorityInstruction({
            owned: mint,
            owner: mintAuthority,
            authorityType: AuthorityType.MintTokens,
            newAuthority: some(multisig),
        }),
    ]);
    const account = await createConfidentialTokenAccount({ client, payer, owner: multisig, mint, multiSigners });

    // When the multisig members mint.
    const [{ data: destinationTokenAccount }, { data: mintAccount }] = await Promise.all([
        fetchToken(client.rpc, account.token),
        fetchMint(client.rpc, mint),
    ]);
    const mintPlan = getConfidentialMintWithInstructionOffsetProofsInstructionPlan({
        token: account.token,
        mint,
        mintAccount,
        destinationTokenAccount,
        authority: multisig,
        multiSigners,
        amount: MINT_AMOUNT,
        supplyElgamalKeypair,
        supplyAesKey,
    });
    expectInstructionOffsetProofsLayout(
        mintPlan,
        data => getConfidentialMintInstructionDataDecoder().decode(data),
        [account.token, mint, SYSVAR_INSTRUCTIONS_ADDRESS, multisig, signerA.address, signerB.address],
        [signerA.address, signerB.address],
    );
    await sendSingleV1Transaction(client, mintPlan);
    await applyPendingBalance({ client, account, authority: multisig, multiSigners });
    expect(await fetchAvailableBalance(client, account)).toBe(MINT_AMOUNT);

    // And the multisig members burn.
    const [{ data: sourceTokenAccount }, { data: mintForBurn }] = await Promise.all([
        fetchToken(client.rpc, account.token),
        fetchMint(client.rpc, mint),
    ]);
    await sendSingleV1Transaction(
        client,
        getConfidentialBurnWithInstructionOffsetProofsInstructionPlan({
            token: account.token,
            mint,
            mintAccount: mintForBurn,
            sourceTokenAccount,
            authority: multisig,
            multiSigners,
            amount: BURN_AMOUNT,
            sourceElgamalKeypair: account.elgamalKeypair,
            aesKey: account.aesKey,
        }),
    );

    // Then the available balance drops by the burnt amount.
    expect(await fetchAvailableBalance(client, account)).toBe(MINT_AMOUNT - BURN_AMOUNT);
});

it('permissioned-burns from a multisig-owned account with sibling proof instructions', async () => {
    // Given a mint-burn + PermissionedBurn mint and an account owned by a 2-of-2 multisig.
    const client = await createValidatorClient({ version: 1 });
    const payer = client.payer;
    const permissionedBurnAuthority = await generateKeyPairSignerWithSol(client);
    const [signerA, signerB] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSignerWithSol(client),
    ]);
    const multiSigners = [signerA, signerB];
    const { mint, mintAuthority, supplyElgamalKeypair, supplyAesKey } = await createConfidentialMintBurnMint({
        client,
        payer,
        decimals: DECIMALS,
        permissionedBurnAuthority,
    });
    const multisig = await createMultisig({ client, payer, signers: multiSigners });
    const account = await createConfidentialTokenAccount({ client, payer, owner: multisig, mint, multiSigners });

    const [{ data: destinationTokenAccount }, { data: mintAccount }] = await Promise.all([
        fetchToken(client.rpc, account.token),
        fetchMint(client.rpc, mint),
    ]);
    await sendSingleV1Transaction(
        client,
        getConfidentialMintWithInstructionOffsetProofsInstructionPlan({
            token: account.token,
            mint,
            mintAccount,
            destinationTokenAccount,
            authority: mintAuthority,
            amount: MINT_AMOUNT,
            supplyElgamalKeypair,
            supplyAesKey,
        }),
    );
    await applyPendingBalance({ client, account, authority: multisig, multiSigners });

    // When the multisig members burn, co-signed by the permissioned burn authority.
    const [{ data: sourceTokenAccount }, { data: mintForBurn }] = await Promise.all([
        fetchToken(client.rpc, account.token),
        fetchMint(client.rpc, mint),
    ]);
    await sendSingleV1Transaction(
        client,
        getPermissionedConfidentialBurnWithInstructionOffsetProofsInstructionPlan({
            token: account.token,
            mint,
            mintAccount: mintForBurn,
            sourceTokenAccount,
            authority: multisig,
            multiSigners,
            permissionedBurnAuthority,
            amount: BURN_AMOUNT,
            sourceElgamalKeypair: account.elgamalKeypair,
            aesKey: account.aesKey,
        }),
    );

    // Then the available balance drops by the burnt amount.
    expect(await fetchAvailableBalance(client, account)).toBe(MINT_AMOUNT - BURN_AMOUNT);
});

it('rejects burning more than the available balance before building any proof', async () => {
    // Given an account with nothing available to burn.
    const client = await createValidatorClient({ version: 1 });
    const payer = client.payer;
    const owner = await generateKeyPairSignerWithSol(client);
    const { mint } = await createConfidentialMintBurnMint({ client, payer, decimals: DECIMALS });
    const account = await createConfidentialTokenAccount({ client, payer, owner, mint });
    const [{ data: sourceTokenAccount }, { data: mintAccount }] = await Promise.all([
        fetchToken(client.rpc, account.token),
        fetchMint(client.rpc, mint),
    ]);

    // When building a burn plan for a positive amount, then it throws.
    expect(() =>
        getConfidentialBurnWithInstructionOffsetProofsInstructionPlan({
            token: account.token,
            mint,
            mintAccount,
            sourceTokenAccount,
            authority: owner,
            amount: BURN_AMOUNT,
            sourceElgamalKeypair: account.elgamalKeypair,
            aesKey: account.aesKey,
        }),
    ).toThrow('Insufficient funds.');
});

it('rejects a mint whose sibling proof instructions are missing or out of order', async () => {
    // Given a valid sibling-proof mint plan.
    const client = await createValidatorClient({ version: 1 });
    const payer = client.payer;
    const owner = await generateKeyPairSignerWithSol(client);
    const { mint, mintAuthority, supplyElgamalKeypair, supplyAesKey } = await createConfidentialMintBurnMint({
        client,
        payer,
        decimals: DECIMALS,
    });
    const account = await createConfidentialTokenAccount({ client, payer, owner, mint });
    const [{ data: destinationTokenAccount }, { data: mintAccount }] = await Promise.all([
        fetchToken(client.rpc, account.token),
        fetchMint(client.rpc, mint),
    ]);
    const [mintInstruction, equality, ciphertextValidity, range] = getPlanInstructions(
        getConfidentialMintWithInstructionOffsetProofsInstructionPlan({
            token: account.token,
            mint,
            mintAccount,
            destinationTokenAccount,
            authority: mintAuthority,
            amount: MINT_AMOUNT,
            supplyElgamalKeypair,
            supplyAesKey,
        }),
    );

    // When the range verify is dropped, then the program rejects the mint
    // instruction (its range offset points past the end of the transaction).
    const missingProofError = await getRootCauseOfRejection(
        client.sendTransaction(nonDivisibleSequentialInstructionPlan([mintInstruction, equality, ciphertextValidity])),
    );
    expect(isSolanaError(missingProofError, SOLANA_ERROR__INSTRUCTION_ERROR__INVALID_INSTRUCTION_DATA)).toBe(true);
    expect(missingProofError).toMatchObject({ context: { index: 0 } });

    // When the validity and range verifies are swapped, then the program rejects
    // the mint instruction (each offset now points at the wrong proof type).
    const swappedProofsError = await getRootCauseOfRejection(
        client.sendTransaction(
            nonDivisibleSequentialInstructionPlan([mintInstruction, equality, range, ciphertextValidity]),
        ),
    );
    expect(isSolanaError(swappedProofsError, SOLANA_ERROR__INSTRUCTION_ERROR__INVALID_INSTRUCTION_DATA)).toBe(true);
    expect(swappedProofsError).toMatchObject({ context: { index: 0 } });

    // And nothing was minted.
    expect(await fetchDecryptableSupply({ client, mint, supplyAesKey })).toBe(0n);
});

it('requires resource-limit estimation for sibling-proof mints on v1', async () => {
    // Given a sibling-proof mint plan.
    const client = await createValidatorClient({ version: 1 });
    const payer = client.payer;
    const owner = await generateKeyPairSignerWithSol(client);
    const { mint, mintAuthority, supplyElgamalKeypair, supplyAesKey } = await createConfidentialMintBurnMint({
        client,
        payer,
        decimals: DECIMALS,
    });
    const account = await createConfidentialTokenAccount({ client, payer, owner, mint });
    const [{ data: destinationTokenAccount }, { data: mintAccount }] = await Promise.all([
        fetchToken(client.rpc, account.token),
        fetchMint(client.rpc, mint),
    ]);
    const mintPlan = getConfidentialMintWithInstructionOffsetProofsInstructionPlan({
        token: account.token,
        mint,
        mintAccount,
        destinationTokenAccount,
        authority: mintAuthority,
        amount: MINT_AMOUNT,
        supplyElgamalKeypair,
        supplyAesKey,
    });

    // When it is sent by a v1 client with estimation off, then it fails: unset
    // v1 resource limits mean 0 compute units and 0 loaded account bytes.
    const clientWithoutEstimation = await createValidatorClient({ version: 1, estimateResourceLimits: false });
    const error = await getRootCauseOfRejection(clientWithoutEstimation.sendTransaction(mintPlan));
    expect(isSolanaError(error, SOLANA_ERROR__TRANSACTION_ERROR__MAX_LOADED_ACCOUNTS_DATA_SIZE_EXCEEDED)).toBe(true);
});

it('does not fit a sibling-proof mint in a single legacy/v0 transaction', async () => {
    // Given a default (v0) client and a sibling-proof mint plan.
    const client = await createValidatorClient();
    const payer = client.payer;
    const owner = await generateKeyPairSignerWithSol(client);
    const { mint, mintAuthority, supplyElgamalKeypair, supplyAesKey } = await createConfidentialMintBurnMint({
        client,
        payer,
        decimals: DECIMALS,
    });
    const account = await createConfidentialTokenAccount({ client, payer, owner, mint });
    const [{ data: destinationTokenAccount }, { data: mintAccount }] = await Promise.all([
        fetchToken(client.rpc, account.token),
        fetchMint(client.rpc, mint),
    ]);
    const mintPlan = getConfidentialMintWithInstructionOffsetProofsInstructionPlan({
        token: account.token,
        mint,
        mintAccount,
        destinationTokenAccount,
        authority: mintAuthority,
        amount: MINT_AMOUNT,
        supplyElgamalKeypair,
        supplyAesKey,
    });

    // When planning it as a single transaction, then the planner rejects it.
    const error = await getRootCauseOfRejection(client.planTransaction(mintPlan));
    expect(isSolanaError(error, SOLANA_ERROR__INSTRUCTION_PLANS__UNEXPECTED_TRANSACTION_PLAN)).toBe(true);

    // And planning it as several transactions spreads it over a non-divisible
    // sequence of more than one transaction.
    const transactionPlan = await client.planTransactions(mintPlan);
    expect(transactionPlan.kind).toBe('sequential');
    if (transactionPlan.kind !== 'sequential') return;
    expect(transactionPlan.divisible).toBe(false);
    expect(transactionPlan.plans.length).toBeGreaterThan(1);
});
