import { expect, it } from 'vitest';
import { Account, generateKeyPairSigner, some } from '@solana/kit';
import { AccountState, Mint, extension, fetchMint, getUpdateDefaultAccountStateInstruction } from '../../../src';
import { createTestClient, createMint, generateKeyPairSignerWithSol } from '../../_setup';

it('updates the default state account on a mint account', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, freezeAuthority] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSigner(),
    ]);

    // And a mint account initialized with a default account state extension.
    const mint = await createMint({
        authority,
        client,
        extensions: [extension('DefaultAccountState', { state: AccountState.Frozen })],
        freezeAuthority: freezeAuthority.address,
        payer: authority,
    });

    // When we update the default account state on the mint account.
    await client.sendTransaction([
        getUpdateDefaultAccountStateInstruction({
            mint,
            freezeAuthority,
            state: AccountState.Initialized,
        }),
    ]);

    // Then we expect the mint account to have the following updated data.
    const mintAccount = await fetchMint(client.rpc, mint);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint,
        data: {
            extensions: some([extension('DefaultAccountState', { state: AccountState.Initialized })]),
        },
    });
});
