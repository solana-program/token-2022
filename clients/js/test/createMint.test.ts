import { Account, address, generateKeyPairSigner, none, some } from '@solana/kit';
import { expect, it } from 'vitest';

import { Mint, extension, fetchMint } from '../src';
import { createTestClient } from './_setup';

it('creates and initializes a new mint account', async () => {
    // Given an authority and a mint account.
    const client = await createTestClient();
    const [authority, mint] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);

    // When we create and initialize a mint account at this address.
    await client.token2022.instructions
        .createMint({ newMint: mint, decimals: 2, mintAuthority: authority })
        .sendTransaction();

    // Then we expect the mint account to exist and have the following data.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
        data: {
            mintAuthority: some(authority.address),
            supply: 0n,
            decimals: 2,
            isInitialized: true,
            freezeAuthority: none(),
            extensions: none(),
        },
    });
});

it('creates a new mint account with a freeze authority', async () => {
    // Given an authority and a mint account.
    const client = await createTestClient();
    const [mintAuthority, freezeAuthority, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // When we create and initialize a mint account with a freeze authority.
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            decimals: 2,
            mintAuthority,
            freezeAuthority: freezeAuthority.address,
        })
        .sendTransaction();

    // Then we expect the mint account to exist and have the following data.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
        data: {
            mintAuthority: some(mintAuthority.address),
            freezeAuthority: some(freezeAuthority.address),
        },
    });
});

it('creates a new mint account with extensions', async () => {
    // Given an authority and a mint account.
    const client = await createTestClient();
    const [authority, mint] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);

    // And a mint close authority extension.
    const mintCloseAuthorityExtension = extension('MintCloseAuthority', {
        closeAuthority: address('HHS1XymmkBpYAkg3XTbZLxgHa5n11PAWUCWdiVtRmzzS'),
    });

    // When we create and initialize a mint account with this extension.
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            decimals: 2,
            mintAuthority: authority,
            extensions: [mintCloseAuthorityExtension],
        })
        .sendTransaction();

    // Then we expect the mint account to exist with the extension.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
        data: {
            mintAuthority: some(authority.address),
            decimals: 2,
            isInitialized: true,
            extensions: some([mintCloseAuthorityExtension]),
        },
    });
});
