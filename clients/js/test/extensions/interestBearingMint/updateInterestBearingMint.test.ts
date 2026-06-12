import { expect, it } from 'vitest';
import { createTestClient } from '../../_setup';
import { Account, generateKeyPairSigner, isSome } from '@solana/kit';
import { extension, fetchMint, Mint } from '../../../src';

it('updates the interest bearing mint extension on a mint account', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [rateAuthority, mint] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);

    const oldRate = 10000;
    const newRate = 20000;

    // And a mint with an interest bearing mint extension.
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            mintAuthority: rateAuthority,
            extensions: [
                extension('InterestBearingConfig', {
                    rateAuthority: rateAuthority.address,
                    initializationTimestamp: BigInt(Math.floor(new Date().getTime() / 1000)),
                    lastUpdateTimestamp: BigInt(Math.floor(new Date().getTime() / 1000)),
                    preUpdateAverageRate: oldRate,
                    currentRate: oldRate,
                }),
            ],
        })
        .sendTransaction();

    // When we update the interest bearing mint extension on the mint account
    await client.token2022.instructions
        .updateRateInterestBearingMint({ rateAuthority, mint: mint.address, rate: newRate })
        .sendTransaction();

    const mintAccount = await fetchMint(client.rpc, mint.address);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
    });

    // Then the mint account has an interest bearing mint extension.
    const extensions = mintAccount.data.extensions;
    expect(isSome(extensions)).toBe(true);
    expect(isSome(extensions) && extensions.value[0].__kind === 'InterestBearingConfig').toBe(true);

    if (isSome(extensions) && extensions.value[0].__kind === 'InterestBearingConfig') {
        // And the extension has the correct rate authority.
        expect(extensions.value[0].rateAuthority).toBe(rateAuthority.address);
        // And the extension has the correct initialization timestamp.
        expect(typeof extensions.value[0].initializationTimestamp === 'bigint').toBe(true);
        // And the extension has the correct last update timestamp.
        expect(typeof extensions.value[0].lastUpdateTimestamp === 'bigint').toBe(true);
        // And the extension has the correct pre update average rate.
        expect(extensions.value[0].preUpdateAverageRate).toBe(oldRate);
        // And the extension has the correct new current rate.
        expect(extensions.value[0].currentRate).toBe(newRate);
    }
});
