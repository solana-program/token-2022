import { expect, it } from 'vitest';
import { Account, generateKeyPairSigner, some } from '@solana/kit';
import { AccountState, Mint, extension, fetchMint, fetchToken } from '../../../src';
import { createTestClient, createToken, generateKeyPairSignerWithSol } from '../../_setup';

it('initializes a mint account with a default account state extension', async () => {
    // Given an authority and a mint account.
    const client = await createTestClient();
    const [authority, freezeAuthority, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a default account state extension.
    const defaultAccountStateExtension = extension('DefaultAccountState', {
        state: AccountState.Frozen,
    });

    // When we create and initialize a mint account with this extension.
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            mintAuthority: authority,
            freezeAuthority: freezeAuthority.address,
            extensions: [defaultAccountStateExtension],
        })
        .sendTransaction();

    // Then we expect the mint account to exist and have the following data.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
        data: {
            mintAuthority: some(authority.address),
            isInitialized: true,
            extensions: some([defaultAccountStateExtension]),
        },
    });
});

it('initializes a token account with the default state defined on the mint account', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, freezeAuthority, owner, mint] = await Promise.all([
        generateKeyPairSignerWithSol(client),
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

    // When we create a new token account for the mint.
    const token = await createToken({ client, mint: mint.address, owner, payer: authority });

    // Then we expect the token account to have the default state defined on the mint account.
    const tokenAccount = await fetchToken(client.rpc, token);
    expect(tokenAccount.data.state).toBe(AccountState.Frozen);
});
