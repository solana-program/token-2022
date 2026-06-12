import { expect, it } from 'vitest';
import { generateKeyPairSigner, isSome, some } from '@solana/kit';
import { extension, fetchMint } from '../../../src';
import { createTestClient } from '../../_setup';

it('resumes a mint', async () => {
    // Given a fresh client with no state the test cares about.
    const client = await createTestClient();
    const authority = client.payer;
    const mint = await generateKeyPairSigner();

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

    // And when pause the mint.
    await client.token2022.instructions.pause({ mint: mint.address, authority: authority.address }).sendTransaction();

    // And when resume the mint.
    await client.token2022.instructions.resume({ mint: mint.address, authority: authority.address }).sendTransaction();

    // Then we expect the mint account to exist and have the pausable config extension.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    const extensions = mintAccount.data.extensions;
    expect(isSome(extensions)).toBe(true);
    expect(isSome(extensions) && extensions.value[0].__kind === 'PausableConfig').toBe(true);

    if (isSome(extensions) && extensions.value[0].__kind === 'PausableConfig') {
        // And the extension has the correct resumed state.
        expect(extensions.value[0].paused).toBe(false);
    }
});
