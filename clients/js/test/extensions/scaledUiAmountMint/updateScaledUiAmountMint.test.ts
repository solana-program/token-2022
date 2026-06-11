import { expect, it } from 'vitest';
import {
    createDefaultSolanaClient,
    createMint,
    generateKeyPairSignerWithSol,
    sendAndConfirmInstructions,
} from '../../_setup';
import { isSome } from '@solana/kit';
import { extension, fetchMint, getUpdateMultiplierScaledUiMintInstruction } from '../../../src';

it('updates the multiplier of the scaled ui amount mint extension on a mint account', async () => {
    // Given some signer accounts.
    const client = createDefaultSolanaClient();
    const [multiplierAuthority] = await Promise.all([generateKeyPairSignerWithSol(client)]);

    const oldMultiplier = 1;
    const newMultiplier = 2;

    // And a mint with a scaled ui amount mint extension.
    const mint = await createMint({
        authority: multiplierAuthority,
        client,
        extensions: [
            extension('ScaledUiAmountConfig', {
                authority: multiplierAuthority.address,
                multiplier: oldMultiplier,
                newMultiplierEffectiveTimestamp: BigInt(Math.floor(new Date().getTime() * 2)),
                newMultiplier: oldMultiplier,
            }),
        ],
        payer: multiplierAuthority,
    });

    // When we update the scaled ui amount mint extension on the mint account
    await sendAndConfirmInstructions(client, multiplierAuthority, [
        getUpdateMultiplierScaledUiMintInstruction({
            mint,
            authority: multiplierAuthority.address,
            multiplier: newMultiplier,
            effectiveTimestamp: BigInt(Math.floor(new Date().getTime() / 1000)),
        }),
    ]);

    const mintAccount = await fetchMint(client.rpc, mint);

    // Then the mint account has a scaled ui amount mint extension.
    const extensions = mintAccount.data.extensions;
    expect(isSome(extensions)).toBe(true);
    expect(isSome(extensions) && extensions.value[0].__kind === 'ScaledUiAmountConfig').toBe(true);

    if (isSome(extensions) && extensions.value[0].__kind === 'ScaledUiAmountConfig') {
        // And the extension has the correct authority.
        expect(extensions.value[0].authority).toBe(multiplierAuthority.address);
        // And the extension has the correct multiplier.
        expect(typeof extensions.value[0].multiplier === 'number').toBe(true);
        // And the extension has the correct new multiplier effective timestamp.
        expect(typeof extensions.value[0].newMultiplierEffectiveTimestamp === 'bigint').toBe(true);
        // And the extension has the correct new multiplier.
        expect(extensions.value[0].newMultiplier).toBe(newMultiplier);
    }
});
