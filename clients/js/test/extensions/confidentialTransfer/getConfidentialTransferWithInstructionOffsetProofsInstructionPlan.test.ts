import { ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS, ZkElGamalProofInstruction } from '@solana-program/zk-elgamal-proof';
import {
    Instruction,
    InstructionPlan,
    SOLANA_ERROR__INSTRUCTION_ERROR__INVALID_INSTRUCTION_DATA,
    createClient,
    generateKeyPairSigner,
    getAddressDecoder,
    getSignatureFromTransaction,
    getTransactionSize,
    getTransactionSizeLimit,
    isSignerRole,
    isSolanaError,
    nonDivisibleSequentialInstructionPlan,
    some,
} from '@solana/kit';
import { solanaLocalRpc } from '@solana/kit-plugin-rpc';
import { payer as withPayer } from '@solana/kit-plugin-signer';
import { SYSVAR_INSTRUCTIONS_ADDRESS } from '@solana/sysvars';
import { AeKey, ElGamalCiphertext, ElGamalKeypair } from '@solana/zk-sdk/bundler';
import { expect, it } from 'vitest';

import {
    TOKEN_2022_PROGRAM_ADDRESS,
    Token,
    fetchToken,
    getConfidentialDepositInstruction,
    getConfidentialTransferInstructionDataDecoder,
    getMintToInstruction,
} from '../../../src';
import {
    decryptConfidentialTransferBalance,
    getApplyConfidentialPendingBalanceInstructionFromToken,
    getConfidentialTransferWithInstructionOffsetProofsInstructionPlan,
} from '../../../src/confidential';
import {
    createConfidentialMint,
    createConfidentialTokenAccount,
    createConfidentialTokenAccountWithBalance,
    createMultisig,
    createValidatorClient,
    generateKeyPairSignerWithSol,
    getSingleTransactionContext,
    getRootCauseOfRejection,
} from '../../_setup';

function getInstructions(plan: InstructionPlan): Instruction[] {
    if (plan.kind !== 'sequential') throw new Error('Expected a sequential plan.');
    expect(plan.divisible).toBe(false);
    return plan.plans.map(child => {
        if (child.kind !== 'single') throw new Error('Expected a single instruction.');
        return child.instruction;
    });
}

async function expectInvalidProofInstruction(promise: Promise<unknown>) {
    const error = await getRootCauseOfRejection(promise);
    expect(isSolanaError(error, SOLANA_ERROR__INSTRUCTION_ERROR__INVALID_INSTRUCTION_DATA)).toBe(true);
    expect(error).toMatchObject({ context: { index: 0 } });
}

it('constructs inline proofs and forwards multisig members without creating accounts', async () => {
    const [source, mint, destination, multisig, signerA, signerB] = await Promise.all(
        Array.from({ length: 6 }, () => generateKeyPairSigner()),
    );
    const sourceKeys = new ElGamalKeypair();
    const destinationKeys = new ElGamalKeypair();
    const auditor = new ElGamalKeypair();
    const aesKey = new AeKey();
    const sourceTokenAccount = {
        extensions: some([
            {
                __kind: 'ConfidentialTransferAccount',
                availableBalance: sourceKeys.pubkey().encryptU64(1000n).toBytes(),
                decryptableAvailableBalance: aesKey.encrypt(1000n).toBytes(),
            },
        ]),
    } as Token;
    const rpc = new Proxy(
        {},
        {
            get() {
                throw new Error('RPC should not be used');
            },
        },
    );
    const plan = await getConfidentialTransferWithInstructionOffsetProofsInstructionPlan({
        rpc: rpc as Parameters<typeof getConfidentialTransferWithInstructionOffsetProofsInstructionPlan>[0]['rpc'],
        sourceToken: source.address,
        mint: mint.address,
        destinationToken: destination.address,
        sourceTokenAccount,
        destinationElgamalPubkey: getAddressDecoder().decode(destinationKeys.pubkey().toBytes()),
        auditorElgamalPubkey: getAddressDecoder().decode(auditor.pubkey().toBytes()),
        authority: multisig.address,
        multiSigners: [signerA, signerB],
        amount: 600n,
        sourceElgamalKeypair: sourceKeys,
        aesKey,
    });
    const [transfer, ...proofs] = getInstructions(plan);
    expect(proofs).toHaveLength(3);
    expect(transfer.accounts?.map(account => account.address)).toEqual([
        source.address,
        mint.address,
        destination.address,
        SYSVAR_INSTRUCTIONS_ADDRESS,
        multisig.address,
        signerA.address,
        signerB.address,
    ]);
    expect(transfer.accounts?.filter(account => isSignerRole(account.role)).map(account => account.address)).toEqual([
        signerA.address,
        signerB.address,
    ]);
    expect(getConfidentialTransferInstructionDataDecoder().decode(transfer.data!)).toMatchObject({
        equalityProofInstructionOffset: 1,
        ciphertextValidityProofInstructionOffset: 2,
        rangeProofInstructionOffset: 3,
    });
    expect(proofs.map(ix => ix.programAddress)).toEqual(Array(3).fill(ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS));
    expect(proofs.map(ix => ix.data?.[0])).toEqual([
        ZkElGamalProofInstruction.VerifyCiphertextCommitmentEquality,
        ZkElGamalProofInstruction.VerifyBatchedGroupedCiphertext3HandlesValidity,
        ZkElGamalProofInstruction.VerifyBatchedRangeProofU128,
    ]);
});

it('transfers from a multisig-owned confidential account', async () => {
    const client = await createValidatorClient();
    const payer = client.payer;
    const [signerA, signerB, destinationOwner] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSignerWithSol(client),
        generateKeyPairSignerWithSol(client),
    ]);
    const multiSigners = [signerA, signerB];
    const multisig = await createMultisig({ client, payer, signers: multiSigners });
    const { mint, mintAuthority } = await createConfidentialMint({ client, payer });
    const source = await createConfidentialTokenAccount({ client, payer, owner: multisig, mint, multiSigners });
    const destination = await createConfidentialTokenAccount({ client, payer, owner: destinationOwner, mint });
    await client.sendTransaction([
        getMintToInstruction({ mint, token: source.token, mintAuthority, amount: 1000n }),
        getConfidentialDepositInstruction({
            token: source.token,
            mint,
            authority: multisig,
            multiSigners,
            amount: 1000n,
            decimals: 2,
        }),
    ]);
    const { data: pendingSource } = await fetchToken(client.rpc, source.token);
    await client.sendTransaction([
        getApplyConfidentialPendingBalanceInstructionFromToken({
            token: source.token,
            tokenAccount: pendingSource,
            authority: multisig,
            multiSigners,
            elgamalSecretKey: source.elgamalKeypair.secret(),
            aesKey: source.aesKey,
        }),
    ]);
    const [{ data: sourceTokenAccount }, { data: destinationTokenAccount }] = await Promise.all([
        fetchToken(client.rpc, source.token),
        fetchToken(client.rpc, destination.token),
    ]);
    const plan = await getConfidentialTransferWithInstructionOffsetProofsInstructionPlan({
        rpc: client.rpc,
        sourceToken: source.token,
        mint,
        destinationToken: destination.token,
        sourceTokenAccount,
        destinationTokenAccount,
        authority: multisig,
        multiSigners,
        amount: 600n,
        sourceElgamalKeypair: source.elgamalKeypair,
        aesKey: source.aesKey,
    });
    const [transfer, ...verifies] = getInstructions(plan);
    await expect(
        client.sendTransaction(
            nonDivisibleSequentialInstructionPlan([
                { ...transfer, accounts: transfer.accounts!.slice(0, -1) },
                ...verifies,
            ]),
        ),
    ).rejects.toThrow();
    const { transaction } = getSingleTransactionContext(await client.sendTransaction(plan));
    expect(getTransactionSizeLimit(transaction)).toBe(4096);
    expect(getTransactionSize(transaction)).toBeLessThanOrEqual(4096);
    const [{ data: updatedSource }, { data: updatedDestination }] = await Promise.all([
        fetchToken(client.rpc, source.token),
        fetchToken(client.rpc, destination.token),
    ]);
    expect(
        decryptConfidentialTransferBalance({
            tokenAccount: updatedSource,
            elgamalSecretKey: source.elgamalKeypair.secret(),
            aesKey: source.aesKey,
        }).availableBalance,
    ).toBe(400n);
    expect(
        decryptConfidentialTransferBalance({
            tokenAccount: updatedDestination,
            elgamalSecretKey: destination.elgamalKeypair.secret(),
            aesKey: destination.aesKey,
        }).pendingBalance,
    ).toBe(600n);
});

it('transfers with instruction-offset proofs in one v1 transaction and rejects invalid proofs', async () => {
    const client = await createValidatorClient();
    const payer = client.payer;
    const [sourceOwner, destinationOwner] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSignerWithSol(client),
    ]);
    const auditor = new ElGamalKeypair();
    const { mint, mintAuthority } = await createConfidentialMint({
        client,
        payer,
        auditorElgamalPubkey: getAddressDecoder().decode(auditor.pubkey().toBytes()),
    });
    const source = await createConfidentialTokenAccountWithBalance({
        client,
        payer,
        owner: sourceOwner,
        mint,
        mintAuthority,
        decimals: 2,
        amount: 1000n,
    });
    const destination = await createConfidentialTokenAccount({ client, payer, owner: destinationOwner, mint });
    const [{ data: sourceTokenAccount }, { data: destinationTokenAccount }] = await Promise.all([
        fetchToken(client.rpc, source.token),
        fetchToken(client.rpc, destination.token),
    ]);
    // Omit the auditor key and mint account to exercise the RPC fallback.
    const transferInput = {
        rpc: client.rpc,
        sourceToken: source.token,
        mint,
        destinationToken: destination.token,
        sourceTokenAccount,
        destinationTokenAccount,
        authority: sourceOwner,
        amount: 600n,
        sourceElgamalKeypair: source.elgamalKeypair,
        aesKey: source.aesKey,
    };
    const plan = await getConfidentialTransferWithInstructionOffsetProofsInstructionPlan(transferInput);
    const instructions = getInstructions(plan);
    expect(instructions).toHaveLength(4);
    const [transfer, equality, validity, range] = instructions;
    expect(transfer.programAddress).toBe(TOKEN_2022_PROGRAM_ADDRESS);
    expect(transfer.accounts?.map(account => account.address)).toEqual([
        source.token,
        mint,
        destination.token,
        SYSVAR_INSTRUCTIONS_ADDRESS,
        sourceOwner.address,
    ]);
    expect(transfer.accounts?.filter(account => isSignerRole(account.role)).map(account => account.address)).toEqual([
        sourceOwner.address,
    ]);
    const data = getConfidentialTransferInstructionDataDecoder().decode(transfer.data!);
    expect(data).toMatchObject({
        equalityProofInstructionOffset: 1,
        ciphertextValidityProofInstructionOffset: 2,
        rangeProofInstructionOffset: 3,
    });
    expect(
        auditor.secret().decrypt(ElGamalCiphertext.fromBytes(new Uint8Array(data.transferAmountAuditorCiphertextLo))!),
    ).toBe(600n);
    expect(instructions.slice(1).map(ix => ix.programAddress)).toEqual(Array(3).fill(ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS));
    expect(instructions.slice(1).map(ix => ix.accounts ?? [])).toEqual([[], [], []]);
    expect(instructions.slice(1).map(ix => ix.data?.[0])).toEqual([
        ZkElGamalProofInstruction.VerifyCiphertextCommitmentEquality,
        ZkElGamalProofInstruction.VerifyBatchedGroupedCiphertext3HandlesValidity,
        ZkElGamalProofInstruction.VerifyBatchedRangeProofU128,
    ]);
    expect(instructions.slice(1).map(ix => ix.data?.length)).toEqual([321, 545, 1001]);

    await expectInvalidProofInstruction(
        client.sendTransaction(nonDivisibleSequentialInstructionPlan([transfer, equality, validity])),
    );
    await expectInvalidProofInstruction(
        client.sendTransaction(nonDivisibleSequentialInstructionPlan([transfer, equality, range, validity])),
    );
    await expectInvalidProofInstruction(
        client.sendTransaction(
            nonDivisibleSequentialInstructionPlan([
                transfer,
                { ...equality, programAddress: TOKEN_2022_PROGRAM_ADDRESS },
                validity,
                range,
            ]),
        ),
    );
    const [, otherEquality] = getInstructions(
        await getConfidentialTransferWithInstructionOffsetProofsInstructionPlan({ ...transferInput, amount: 300n }),
    );
    const mismatchedProofError = await getRootCauseOfRejection(
        client.sendTransaction(nonDivisibleSequentialInstructionPlan([transfer, otherEquality, validity, range])),
    );
    expect(mismatchedProofError).toMatchObject({ context: { index: 0 } });
    const invalidProofData = new Uint8Array(range.data!);
    invalidProofData[invalidProofData.length - 1] ^= 1;
    const signaturesBefore = await client.rpc.getSignaturesForAddress(source.token, { limit: 1 }).send();
    // Send the invalid proof to the validator, rather than stopping at preflight.
    const noPreflightClient = createClient()
        .use(withPayer(payer))
        .use(solanaLocalRpc({ skipPreflight: true }));
    await expect(
        noPreflightClient.sendTransaction(
            nonDivisibleSequentialInstructionPlan([transfer, equality, validity, { ...range, data: invalidProofData }]),
        ),
    ).rejects.toThrow();
    const signaturesAfter = await client.rpc.getSignaturesForAddress(source.token, { limit: 1 }).send();
    expect(signaturesAfter[0].signature).not.toBe(signaturesBefore[0].signature);
    const failedTransaction = await client.rpc
        .getTransaction(signaturesAfter[0].signature, {
            commitment: 'confirmed',
            encoding: 'base64',
            maxSupportedTransactionVersion: 1,
        })
        .send();
    expect(failedTransaction?.meta?.err).toMatchObject({ InstructionError: [3n, expect.anything()] });

    const [{ data: sourceAfterFailure }, { data: destinationAfterFailure }] = await Promise.all([
        fetchToken(client.rpc, source.token),
        fetchToken(client.rpc, destination.token),
    ]);
    expect(
        decryptConfidentialTransferBalance({
            tokenAccount: sourceAfterFailure,
            elgamalSecretKey: source.elgamalKeypair.secret(),
            aesKey: source.aesKey,
        }).availableBalance,
    ).toBe(1000n);
    expect(
        decryptConfidentialTransferBalance({
            tokenAccount: destinationAfterFailure,
            elgamalSecretKey: destination.elgamalKeypair.secret(),
            aesKey: destination.aesKey,
        }).pendingBalance,
    ).toBe(0n);

    const { transaction } = getSingleTransactionContext(await client.sendTransaction(plan));
    expect(getTransactionSizeLimit(transaction)).toBe(4096);
    expect(getTransactionSize(transaction)).toBeLessThanOrEqual(4096);
    const confirmed = await client.rpc
        .getTransaction(getSignatureFromTransaction(transaction), {
            commitment: 'confirmed',
            encoding: 'base64',
            maxSupportedTransactionVersion: 1,
        })
        .send();
    expect(confirmed?.meta?.computeUnitsConsumed).toBeDefined();
    const [{ data: updatedSource }, { data: updatedDestination }] = await Promise.all([
        fetchToken(client.rpc, source.token),
        fetchToken(client.rpc, destination.token),
    ]);
    const sourceBalance = decryptConfidentialTransferBalance({
        tokenAccount: updatedSource,
        elgamalSecretKey: source.elgamalKeypair.secret(),
        aesKey: source.aesKey,
    });
    const destinationBalance = decryptConfidentialTransferBalance({
        tokenAccount: updatedDestination,
        elgamalSecretKey: destination.elgamalKeypair.secret(),
        aesKey: destination.aesKey,
    });
    expect(sourceBalance.availableBalance).toBe(400n);
    expect(destinationBalance.pendingBalance).toBe(600n);
    expect(destinationBalance.pendingBalanceCreditCounter).toBe(1n);
});
