import { expect, it } from 'vitest';
import { generateKeyPairSigner } from '@solana/kit';
import { Mint, Token, fetchMint, fetchToken, getMintToInstruction } from '../src';
import { createTestClient, createMint, createToken } from './_setup';

it('mints tokens to a token account', async () => {
    // Given a mint account and a token account.
    const client = await createTestClient();
    const [mintAuthority, owner] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    const mint = await createMint({ client, payer: client.payer, authority: mintAuthority });
    const token = await createToken({ client, payer: client.payer, mint, owner });

    // When the mint authority mints tokens to the token account.
    const mintTo = getMintToInstruction({
        mint,
        token,
        mintAuthority,
        amount: 100n,
    });
    await client.sendTransaction([mintTo]);

    // Then we expect the mint and token accounts to have the following updated data.
    const [{ data: mintData }, { data: tokenData }] = await Promise.all([
        fetchMint(client.rpc, mint),
        fetchToken(client.rpc, token),
    ]);
    expect(mintData).toMatchObject(<Mint>{ supply: 100n });
    expect(tokenData).toMatchObject(<Token>{ amount: 100n });
});
