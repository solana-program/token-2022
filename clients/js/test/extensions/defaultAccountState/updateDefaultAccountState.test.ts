import { Account, generateKeyPairSigner, some } from '@solana/kit';
import { expect, it } from 'vitest';

import { AccountState, Mint, extension, fetchMint } from '../../../src';
import { createTestClient } from '../../_setup';

it('updates the default state account on a mint account', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, freezeAuthority, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a mint account initialized with a default account state extension.
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            mintAuthority: authority,
            freezeAuthority: freezeAuthority.address,
            extensions: [extension('DefaultAccountState', { state: AccountState.Frozen })],
        })
        .sendTransaction();

    // When we update the default account state on the mint account.
    await client.token2022.instructions
        .updateDefaultAccountState({ mint: mint.address, freezeAuthority, state: AccountState.Initialized })
        .sendTransaction();

    // Then we expect the mint account to have the following updated data.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
        data: {
            extensions: some([extension('DefaultAccountState', { state: AccountState.Initialized })]),
        },
    });
});
