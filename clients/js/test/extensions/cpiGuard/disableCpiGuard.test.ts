import { Account, generateKeyPairSigner, some } from '@solana/kit';
import { expect, it } from 'vitest';

import { Token, extension, fetchToken } from '../../../src';
import { createTestClient, createToken } from '../../_setup';

it('initializes a token account with a disabled CPI guard extension', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, token, owner, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a mint account.
    await client.token2022.instructions.createMint({ newMint: mint, mintAuthority: authority }).sendTransaction();

    // When we create a token account and disable CPI guard.
    const cpiGuardExtension = extension('CpiGuard', {
        lockCpi: false,
    });
    await client.token2022.instructions
        .createToken({
            newToken: token,
            mint: mint.address,
            owner,
            extensions: [cpiGuardExtension],
        })
        .sendTransaction();

    // Then we expect the token account to exist and have the following extension.
    const tokenAccount = await fetchToken(client.rpc, token.address);
    expect(tokenAccount).toMatchObject(<Account<Token>>{
        address: token.address,
        data: {
            extensions: some([cpiGuardExtension]),
        },
    });
});

it('disables CPI guard on a token account', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, owner, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a token account with an enabled CPI guard extension.
    await client.token2022.instructions.createMint({ newMint: mint, mintAuthority: authority }).sendTransaction();
    const token = await createToken({
        client,
        extensions: [extension('CpiGuard', { lockCpi: true })],
        mint: mint.address,
        owner,
        payer: client.payer,
    });

    // When we disable the CPI guard extension.
    await client.token2022.instructions.disableCpiGuard({ token, owner }).sendTransaction();

    // Then we expect the token account to have CPI guard disabled.
    const tokenAccount = await fetchToken(client.rpc, token);
    expect(tokenAccount.data.extensions).toEqual(some([extension('CpiGuard', { lockCpi: false })]));
});
