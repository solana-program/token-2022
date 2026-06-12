import { expect, it } from 'vitest';
import { generateKeyPairSigner } from '@solana/kit';
import { Mint, Token, fetchMint, fetchToken } from '../src';
import { createTestClient, createToken } from './_setup';

it('mints tokens to a token account', async () => {
    // Given a mint account and a token account.
    const client = await createTestClient();
    const [mintAuthority, owner, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    await client.token2022.instructions.createMint({ newMint: mint, mintAuthority }).sendTransaction();
    const token = await createToken({ client, payer: client.payer, mint: mint.address, owner });

    // When the mint authority mints tokens to the token account.
    await client.token2022.instructions
        .mintTo({ mint: mint.address, token, mintAuthority, amount: 100n })
        .sendTransaction();

    // Then we expect the mint and token accounts to have the following updated data.
    const [{ data: mintData }, { data: tokenData }] = await Promise.all([
        fetchMint(client.rpc, mint.address),
        fetchToken(client.rpc, token),
    ]);
    expect(mintData).toMatchObject(<Mint>{ supply: 100n });
    expect(tokenData).toMatchObject(<Token>{ amount: 100n });
});
