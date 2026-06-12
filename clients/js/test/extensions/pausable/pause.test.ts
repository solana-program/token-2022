import { expect, it } from 'vitest';
import { generateKeyPairSigner, isSome, some } from '@solana/kit';
import { getInitializePausableConfigInstruction, extension, fetchMint, getPauseInstruction } from '../../../src';
import { createTestClient, getCreateMintInstructions } from '../../_setup';

it('pauses a mint', async () => {
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

    // And when pause the mint.
    const pauseInstruction = getPauseInstruction({
        mint: mint.address,
        authority: authority.address,
    });
    await client.sendTransaction([pauseInstruction]);

    // Then we expect the mint account to exist and have the pausable config extension.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    const extensions = mintAccount.data.extensions;
    expect(isSome(extensions)).toBe(true);
    expect(isSome(extensions) && extensions.value[0].__kind === 'PausableConfig').toBe(true);

    if (isSome(extensions) && extensions.value[0].__kind === 'PausableConfig') {
        // And the extension has the correct paused state.
        expect(extensions.value[0].paused).toBe(true);
    }
});
