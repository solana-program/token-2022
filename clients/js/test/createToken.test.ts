import { Account, generateKeyPairSigner, none, some } from '@solana/kit';
import { expect, it } from 'vitest';

import { AccountState, Token, extension, fetchToken } from '../src';
import { createTestClient } from './_setup';

it('creates and initializes a new token account', async () => {
    // Given a mint account and a token owner.
    const client = await createTestClient();
    const [mintAuthority, owner, token, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    await client.token2022.instructions.createMint({ newMint: mint, mintAuthority }).sendTransaction();

    // When we create and initialize a token account at this address.
    await client.token2022.instructions.createToken({ newToken: token, mint: mint.address, owner }).sendTransaction();

    // Then we expect the token account to exist and have the following data.
    expect(await fetchToken(client.rpc, token.address)).toMatchObject(<Account<Token>>{
        address: token.address,
        data: {
            mint: mint.address,
            owner: owner.address,
            amount: 0n,
            delegate: none(),
            state: AccountState.Initialized,
        },
    });
});

it('creates a token account with extensions', async () => {
    // Given a mint account and a token owner.
    const client = await createTestClient();
    const [mintAuthority, owner, token, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    await client.token2022.instructions.createMint({ newMint: mint, mintAuthority }).sendTransaction();

    // And a CPI guard extension.
    const cpiGuardExtension = extension('CpiGuard', { lockCpi: true });

    // When we create and initialize a token account with this extension.
    await client.token2022.instructions
        .createToken({ newToken: token, mint: mint.address, owner, extensions: [cpiGuardExtension] })
        .sendTransaction();

    // Then we expect the token account to exist with the extension.
    expect(await fetchToken(client.rpc, token.address)).toMatchObject(<Account<Token>>{
        address: token.address,
        data: {
            mint: mint.address,
            owner: owner.address,
            extensions: some([cpiGuardExtension]),
        },
    });
});
