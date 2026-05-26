import { generateKeyPairSigner } from '@solana/kit';
import * as zk from '@solana/zk-sdk/node';
import test from 'ava';
import {
    getConfidentialTransferInstructionPlan,
    getConfidentialWithdrawInstructionPlan,
    getCreateConfidentialTransferAccountInstructionPlan,
    type Token,
} from '../../../src';
import { createDefaultSolanaClient } from '../../_setup';

test('it rejects create helper authority that does not match the owner ATA flow', async t => {
    const [payer, owner, delegatedAuthority] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const elgamalKeypair = new zk.ElGamalKeypair();
    const aesKey = new zk.AeKey();

    await t.throwsAsync(
        () =>
            getCreateConfidentialTransferAccountInstructionPlan({
                payer,
                owner,
                authority: delegatedAuthority,
                mint: payer.address,
                rpc: createDefaultSolanaClient().rpc,
                zk,
                elgamalKeypair,
                aesKey,
            }),
        {
            message: /authority must match owner/i,
        },
    );
});

test('it rejects instruction-data proof mode for confidential withdraw', async t => {
    const [payer, owner] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    const elgamalKeypair = new zk.ElGamalKeypair();
    const aesKey = new zk.AeKey();

    await t.throwsAsync(
        () =>
            getConfidentialWithdrawInstructionPlan({
                payer,
                rpc: createDefaultSolanaClient().rpc,
                token: payer.address,
                mint: owner.address,
                tokenAccount: {} as Token,
                authority: owner,
                amount: 1n,
                decimals: 0,
                zk,
                elgamalKeypair,
                aesKey,
                proofMode: 'instruction-data',
            } as unknown as Parameters<typeof getConfidentialWithdrawInstructionPlan>[0]),
        {
            message: /instruction-data proof mode is unsupported/i,
        },
    );
});

test('it rejects instruction-data proof mode for confidential transfer', async t => {
    const [payer, owner] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    const sourceElgamalKeypair = new zk.ElGamalKeypair();
    const aesKey = new zk.AeKey();

    await t.throwsAsync(
        () =>
            getConfidentialTransferInstructionPlan({
                payer,
                rpc: createDefaultSolanaClient().rpc,
                sourceToken: payer.address,
                mint: owner.address,
                destinationToken: payer.address,
                sourceTokenAccount: {} as Token,
                authority: owner,
                amount: 1n,
                zk,
                sourceElgamalKeypair,
                aesKey,
                proofMode: 'instruction-data',
            } as unknown as Parameters<typeof getConfidentialTransferInstructionPlan>[0]),
        {
            message: /instruction-data proof mode is unsupported/i,
        },
    );
});
