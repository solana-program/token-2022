import { expect, it } from 'vitest';
import { createTestClient } from '../../_setup';
import { Account, generateKeyPairSigner, isSome } from '@solana/kit';
import { extension, fetchMint, Mint } from '../../../src';

it('initialize a mint account with a scaled ui amount mint extension', async () => {
    // Given a fresh client with no state the test cares about.
    const client = await createTestClient();
    const [authority, mint] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);

    const multiplier = 1;
    const newMultiplier = 2;

    // And a scaled ui amount mint extension.
    const scaledUiAmountMintExtension = extension('ScaledUiAmountConfig', {
        authority: authority.address,
        multiplier,
        newMultiplierEffectiveTimestamp: BigInt(Math.floor(new Date().getTime() / 1000)),
        newMultiplier,
    });

    // When we initialize the mint account with the scaled ui amount mint extension.
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            decimals: 2,
            mintAuthority: authority,
            extensions: [scaledUiAmountMintExtension],
        })
        .sendTransaction();

    const mintAccount = await fetchMint(client.rpc, mint.address);
    // Then the mint account exists.
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
    });

    const extensions = mintAccount.data.extensions;

    // And the mint account has a scaled ui amount mint extension.
    expect(isSome(extensions)).toBe(true);
    expect(isSome(extensions) && extensions.value[0].__kind === 'ScaledUiAmountConfig').toBe(true);

    if (isSome(extensions) && extensions.value[0].__kind === 'ScaledUiAmountConfig') {
        // And the extension has the correct authority.
        expect(extensions.value[0].authority).toBe(authority.address);
        // And the extension has the correct multiplier.
        expect(extensions.value[0].multiplier).toBe(multiplier);
        // And the extension has the correct new multiplier effective timestamp.
        expect(typeof extensions.value[0].newMultiplierEffectiveTimestamp === 'bigint').toBe(true);
        // And the extension has the correct new multiplier which is not changed due to how the extension is initialized.
        expect(extensions.value[0].newMultiplier).toBe(multiplier);
    }
});
