import { generateKeyPairSigner } from '@solana/kit';
import { AeKey, ElGamalKeypair } from '@solana/zk-sdk/bundler';
import { expect, it } from 'vitest';

import { getCreateConfidentialTransferAccountInstructionPlan } from '../../../src/confidential';
import { createTestClient } from '../../_setup';

it('rejects create helper authority that does not match the owner ATA flow', async () => {
    const [payer, owner, delegatedAuthority] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const elgamalKeypair = new ElGamalKeypair();
    const aesKey = new AeKey();
    const client = await createTestClient();

    await expect(
        getCreateConfidentialTransferAccountInstructionPlan({
            payer,
            owner,
            authority: delegatedAuthority,
            mint: payer.address,
            rpc: client.rpc,
            elgamalKeypair,
            aesKey,
        }),
    ).rejects.toThrow(/authority must match owner/i);
});
