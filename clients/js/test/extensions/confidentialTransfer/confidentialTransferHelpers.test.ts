import { generateKeyPairSigner } from '@solana/kit';
import * as zk from '@solana/zk-sdk/node';
import test from 'ava';
import {
    type ConfidentialTransferZkClient,
    getConfidentialTransferInstructions,
    getConfidentialWithdrawInstructions,
    getCreateConfidentialTransferAccountInstructionPlan,
    type Token,
} from '../../../src';
import { createDefaultSolanaClient } from '../../_setup';

const zkClient = zk as unknown as ConfidentialTransferZkClient;

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
                zk: zkClient,
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
            getConfidentialWithdrawInstructions({
                payer,
                rpc: createDefaultSolanaClient().rpc,
                token: payer.address,
                mint: owner.address,
                tokenAccount: {} as Token,
                authority: owner,
                amount: 1n,
                decimals: 0,
                zk: zkClient,
                elgamalKeypair,
                aesKey,
                proofMode: 'instruction-data',
            } as unknown as Parameters<typeof getConfidentialWithdrawInstructions>[0]),
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
            getConfidentialTransferInstructions({
                payer,
                rpc: createDefaultSolanaClient().rpc,
                sourceToken: payer.address,
                mint: owner.address,
                destinationToken: payer.address,
                sourceTokenAccount: {} as Token,
                authority: owner,
                amount: 1n,
                zk: zkClient,
                sourceElgamalKeypair,
                aesKey,
                proofMode: 'instruction-data',
            } as unknown as Parameters<typeof getConfidentialTransferInstructions>[0]),
        {
            message: /instruction-data proof mode is unsupported/i,
        },
    );
});
