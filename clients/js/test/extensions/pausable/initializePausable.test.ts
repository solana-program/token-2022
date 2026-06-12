import { expect, it } from 'vitest';
import { Account, generateKeyPairSigner, some } from '@solana/kit';
import { extension, fetchMint, Mint } from '../../../src';
import { createTestClient } from '../../_setup';

it('initializes a mint with a pausable config', async () => {
    // Given a fresh client with no state the test cares about.
    const client = await createTestClient();
    const [authority, mint] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);

    // And a pausable config extension.
    const pausableConfigExtension = extension('PausableConfig', {
        authority: some(authority.address),
        paused: false,
    });

    // When we initialize the mint with the pausable config extension.
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            decimals: 2,
            mintAuthority: authority,
            extensions: [pausableConfigExtension],
        })
        .sendTransaction();

    // Then we expect the mint account to exist and have the following data.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
        data: {
            mintAuthority: some(authority.address),
            isInitialized: true,
            extensions: some([pausableConfigExtension]),
        },
    });
});
