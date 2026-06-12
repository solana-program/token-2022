import { expect, it } from 'vitest';
import { Account, generateKeyPairSigner, some } from '@solana/kit';
import { getInitializePausableConfigInstruction, extension, fetchMint, Mint } from '../../../src';
import { createTestClient, generateKeyPairSignerWithSol, getCreateMintInstructions } from '../../_setup';

it('initializes a mint with a pausable config', async () => {
    // Given a fresh client with no state the test cares about.
    const client = await createTestClient();
    const [authority, mint] = await Promise.all([generateKeyPairSignerWithSol(client), generateKeyPairSigner()]);

    // And a pausable config extension.
    const pausableConfigExtension = extension('PausableConfig', {
        authority: some(authority.address),
        paused: false,
    });

    // When we initialize the mint with the pausable config extension.
    const [createMintInstruction, initMintInstruction] = await getCreateMintInstructions({
        authority: authority.address,
        client,
        decimals: 2,
        extensions: [pausableConfigExtension],
        mint,
        payer: authority,
    });
    await client.sendTransaction([
        createMintInstruction,
        getInitializePausableConfigInstruction({
            mint: mint.address,
            authority: authority.address,
        }),
        initMintInstruction,
    ]);

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
