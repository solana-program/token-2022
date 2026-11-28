import { ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS, ZkElGamalProofInstruction } from '@solana-program/zk-elgamal-proof';
import {
    Instruction,
    InstructionPlan,
    SOLANA_ERROR__INSTRUCTION_ERROR__INVALID_INSTRUCTION_DATA,
    createClient,
    getSignatureFromTransaction,
    getTransactionSize,
    getTransactionSizeLimit,
    isSignerRole,
    isSolanaError,
    nonDivisibleSequentialInstructionPlan,
} from '@solana/kit';
import { solanaLocalRpc } from '@solana/kit-plugin-rpc';
import { payer as withPayer } from '@solana/kit-plugin-signer';
import { SYSVAR_INSTRUCTIONS_ADDRESS } from '@solana/sysvars';
import { expect, it } from 'vitest';

import {
    TOKEN_2022_PROGRAM_ADDRESS,
    fetchToken,
    getConfidentialDepositInstruction,
    getConfidentialWithdrawInstructionDataDecoder,
    getMintToInstruction,
} from '../../../src';
import {
    decryptConfidentialTransferBalance,
    getApplyConfidentialPendingBalanceInstructionFromToken,
    getConfidentialWithdrawWithInstructionOffsetProofsInstructionPlan,
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

it('withdraws in one v1 transaction and rolls back a failed proof', async () => {
    const client = await createValidatorClient();
    const payer = client.payer;
    const owner = await generateKeyPairSignerWithSol(client);
    const { mint, mintAuthority } = await createConfidentialMint({ client, payer });
    const account = await createConfidentialTokenAccountWithBalance({
        client,
        payer,
        owner,
        mint,
        mintAuthority,
        decimals: 2,
        amount: 1000n,
    });
    // Keep additional funds pending; they cannot fund a withdrawal.
    await client.sendTransaction([
        getMintToInstruction({ mint, token: account.token, mintAuthority, amount: 250n }),
        getConfidentialDepositInstruction({ token: account.token, mint, authority: owner, amount: 250n, decimals: 2 }),
    ]);
    const { data: tokenAccount } = await fetchToken(client.rpc, account.token);
    const input = {
        token: account.token,
        mint,
        tokenAccount,
        authority: owner,
        amount: 400n,
        decimals: 2,
        elgamalKeypair: account.elgamalKeypair,
        aesKey: account.aesKey,
    };
    expect(() =>
        getConfidentialWithdrawWithInstructionOffsetProofsInstructionPlan({ ...input, amount: 1001n }),
    ).toThrow('Insufficient funds.');
    const plan = getConfidentialWithdrawWithInstructionOffsetProofsInstructionPlan(input);
    const instructions = getInstructions(plan);
    expect(instructions).toHaveLength(3);
    const [withdraw, equality, range] = instructions;
    expect(withdraw.programAddress).toBe(TOKEN_2022_PROGRAM_ADDRESS);
    expect(withdraw.accounts?.map(meta => meta.address)).toEqual([
        account.token,
        mint,
        SYSVAR_INSTRUCTIONS_ADDRESS,
        owner.address,
    ]);
    expect(withdraw.accounts?.filter(meta => isSignerRole(meta.role)).map(meta => meta.address)).toEqual([
        owner.address,
    ]);
    expect(getConfidentialWithdrawInstructionDataDecoder().decode(withdraw.data!)).toMatchObject({
        equalityProofInstructionOffset: 1,
        rangeProofInstructionOffset: 2,
        amount: 400n,
        decimals: 2,
    });
    expect([equality, range].map(ix => ix.programAddress)).toEqual(Array(2).fill(ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS));
    expect([equality, range].map(ix => ix.accounts ?? [])).toEqual([[], []]);
    expect([equality, range].map(ix => ix.data?.[0])).toEqual([
        ZkElGamalProofInstruction.VerifyCiphertextCommitmentEquality,
        ZkElGamalProofInstruction.VerifyBatchedRangeProofU64,
    ]);
    await expectInvalidProofInstruction(
        client.sendTransaction(nonDivisibleSequentialInstructionPlan([withdraw, equality])),
    );
    await expectInvalidProofInstruction(
        client.sendTransaction(nonDivisibleSequentialInstructionPlan([withdraw, range, equality])),
    );
    await expectInvalidProofInstruction(
        client.sendTransaction(
            nonDivisibleSequentialInstructionPlan([
                withdraw,
                { ...equality, programAddress: TOKEN_2022_PROGRAM_ADDRESS },
                range,
            ]),
        ),
    );
    const [, otherEquality] = getInstructions(
        getConfidentialWithdrawWithInstructionOffsetProofsInstructionPlan({ ...input, amount: 300n }),
    );
    const mismatchedProofError = await getRootCauseOfRejection(
        client.sendTransaction(nonDivisibleSequentialInstructionPlan([withdraw, otherEquality, range])),
    );
    expect(mismatchedProofError).toMatchObject({ context: { index: 0 } });
    const badProofData = new Uint8Array(range.data!);
    badProofData[badProofData.length - 1] ^= 1;
    const signaturesBefore = await client.rpc.getSignaturesForAddress(account.token, { limit: 1 }).send();
    const noPreflightClient = createClient()
        .use(withPayer(payer))
        .use(solanaLocalRpc({ skipPreflight: true }));
    await expect(
        noPreflightClient.sendTransaction(
            nonDivisibleSequentialInstructionPlan([withdraw, equality, { ...range, data: badProofData }]),
        ),
    ).rejects.toThrow();
    const signaturesAfter = await client.rpc.getSignaturesForAddress(account.token, { limit: 1 }).send();
    expect(signaturesAfter[0].signature).not.toBe(signaturesBefore[0].signature);
    const failed = await client.rpc
        .getTransaction(signaturesAfter[0].signature, {
            commitment: 'confirmed',
            encoding: 'base64',
            maxSupportedTransactionVersion: 1,
        })
        .send();
    expect(failed?.meta?.err).toMatchObject({ InstructionError: [2n, expect.anything()] });
    const { data: afterFailure } = await fetchToken(client.rpc, account.token);
    const failedBalance = decryptConfidentialTransferBalance({
        tokenAccount: afterFailure,
        elgamalSecretKey: account.elgamalKeypair.secret(),
        aesKey: account.aesKey,
    });
    expect(afterFailure.amount).toBe(0n);
    expect(failedBalance.availableBalance).toBe(1000n);
    expect(failedBalance.pendingBalance).toBe(250n);
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
    const { data: updated } = await fetchToken(client.rpc, account.token);
    const balance = decryptConfidentialTransferBalance({
        tokenAccount: updated,
        elgamalSecretKey: account.elgamalKeypair.secret(),
        aesKey: account.aesKey,
    });
    expect(updated.amount).toBe(400n);
    expect(balance.availableBalance).toBe(600n);
    expect(balance.pendingBalance).toBe(250n);
});

it('withdraws from a multisig-owned account and requires its members', async () => {
    const client = await createValidatorClient();
    const payer = client.payer;
    const [signerA, signerB] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSignerWithSol(client),
    ]);
    const multiSigners = [signerA, signerB];
    const multisig = await createMultisig({ client, payer, signers: multiSigners });
    const { mint, mintAuthority } = await createConfidentialMint({ client, payer });
    const account = await createConfidentialTokenAccount({ client, payer, owner: multisig, mint, multiSigners });
    await client.sendTransaction([
        getMintToInstruction({ mint, token: account.token, mintAuthority, amount: 1000n }),
        getConfidentialDepositInstruction({
            token: account.token,
            mint,
            authority: multisig,
            multiSigners,
            amount: 1000n,
            decimals: 2,
        }),
    ]);
    const { data: pending } = await fetchToken(client.rpc, account.token);
    await client.sendTransaction([
        getApplyConfidentialPendingBalanceInstructionFromToken({
            token: account.token,
            tokenAccount: pending,
            authority: multisig,
            multiSigners,
            elgamalSecretKey: account.elgamalKeypair.secret(),
            aesKey: account.aesKey,
        }),
    ]);
    const { data: tokenAccount } = await fetchToken(client.rpc, account.token);
    const plan = getConfidentialWithdrawWithInstructionOffsetProofsInstructionPlan({
        token: account.token,
        mint,
        tokenAccount,
        authority: multisig,
        multiSigners,
        amount: 400n,
        decimals: 2,
        elgamalKeypair: account.elgamalKeypair,
        aesKey: account.aesKey,
    });
    const [withdraw, ...proofs] = getInstructions(plan);
    expect(withdraw.accounts?.map(meta => meta.address)).toEqual([
        account.token,
        mint,
        SYSVAR_INSTRUCTIONS_ADDRESS,
        multisig,
        signerA.address,
        signerB.address,
    ]);
    expect(withdraw.accounts?.filter(meta => isSignerRole(meta.role)).map(meta => meta.address)).toEqual([
        signerA.address,
        signerB.address,
    ]);
    await expect(
        client.sendTransaction(
            nonDivisibleSequentialInstructionPlan([
                { ...withdraw, accounts: withdraw.accounts!.slice(0, -1) },
                ...proofs,
            ]),
        ),
    ).rejects.toThrow();
    const { transaction } = getSingleTransactionContext(await client.sendTransaction(plan));
    expect(getTransactionSizeLimit(transaction)).toBe(4096);
    expect(getTransactionSize(transaction)).toBeLessThanOrEqual(4096);
    const { data: updated } = await fetchToken(client.rpc, account.token);
    expect(updated.amount).toBe(400n);
    expect(
        decryptConfidentialTransferBalance({
            tokenAccount: updated,
            elgamalSecretKey: account.elgamalKeypair.secret(),
            aesKey: account.aesKey,
        }).availableBalance,
    ).toBe(600n);
});
