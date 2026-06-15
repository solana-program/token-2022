import { Account, generateKeyPairSigner, some } from '@solana/kit';
import { expect, it } from 'vitest';

import { Mint, extension, fetchMint } from '../../../src';
import { createTestClient } from '../../_setup';

it('initializes a non-transferable mint', async () => {
    // Given an authority and a mint account.
    const client = await createTestClient();
    const [authority, mint] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);

    // When we create and initialize a mint account as non-transferable
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            mintAuthority: authority,
            extensions: [extension('NonTransferable', {})],
        })
        .sendTransaction();

    // Then we expect the mint to be initialized with the non-transferable extension
    const mintAccount = await fetchMint(client.rpc, mint.address);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
        data: {
            mintAuthority: some(authority.address),
            isInitialized: true,
            extensions: some([extension('NonTransferable', {})]),
        },
    });
});
