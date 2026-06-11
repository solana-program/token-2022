import { generateKeyPairSigner } from '@solana/kit';
import { AeKey, ElGamalKeypair } from '@solana/zk-sdk/bundler';
import test from 'ava';
import { getCreateConfidentialTransferAccountInstructionPlan } from '../../../src/confidential';
import { createDefaultSolanaClient } from '../../_setup';

test('it rejects create helper authority that does not match the owner ATA flow', async t => {
    const [payer, owner, delegatedAuthority] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const elgamalKeypair = new ElGamalKeypair();
    const aesKey = new AeKey();

    await t.throwsAsync(
        () =>
            getCreateConfidentialTransferAccountInstructionPlan({
                payer,
                owner,
                authority: delegatedAuthority,
                mint: payer.address,
                rpc: createDefaultSolanaClient().rpc,
                elgamalKeypair,
                aesKey,
            }),
        {
            message: /authority must match owner/i,
        },
    );
});
