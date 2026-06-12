import { expect, it } from 'vitest';
import { createTestClient, generateKeyPairSignerWithSol, getCreateMintInstructions } from '../../_setup';
import { Account, generateKeyPairSigner, isSome } from '@solana/kit';
import { extension, fetchMint, getInitializeInterestBearingMintInstruction, Mint } from '../../../src';

it('initialize a mint account with an interest bearing mint extension', async () => {
    // Given a fresh client with no state the test cares about.
    const client = await createTestClient();
    const [rateAuthority, mint] = await Promise.all([generateKeyPairSignerWithSol(client), generateKeyPairSigner()]);

    // in bips
    const rate = 10000;

    // And a interest bearing pointer extension.
    const interestBearingMintExtension = extension('InterestBearingConfig', {
        rateAuthority: rateAuthority.address,
        initializationTimestamp: BigInt(Math.floor(new Date().getTime() / 1000)),
        lastUpdateTimestamp: BigInt(Math.floor(new Date().getTime() / 1000)),
        preUpdateAverageRate: rate,
        currentRate: rate,
    });

    // When we initialize the mint account with the interest bearing mint extension.
    const [createMintInstruction, initMintInstruction] = await getCreateMintInstructions({
        authority: rateAuthority.address,
        client,
        extensions: [interestBearingMintExtension],
        mint,
        payer: rateAuthority,
    });
    await client.sendTransaction([
        createMintInstruction,
        getInitializeInterestBearingMintInstruction({
            rateAuthority: rateAuthority.address,
            mint: mint.address,
            rate: rate,
        }),
        initMintInstruction,
    ]);

    const mintAccount = await fetchMint(client.rpc, mint.address);
    // Then the mint account exists.
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
    });

    const extensions = mintAccount.data.extensions;

    // And the mint account has an interest bearing mint extension.
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
        expect(extensions.value[0].preUpdateAverageRate).toBe(rate);
        // And the extension has the correct current rate.
        expect(extensions.value[0].currentRate).toBe(rate);
    }
});
