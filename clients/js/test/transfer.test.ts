import { expect, it } from 'vitest';
import { generateKeyPairSigner } from '@solana/kit';
import { Mint, Token, fetchMint, fetchToken } from '../src';
import { createTestClient, createToken, createTokenWithAmount } from './_setup';

it('transfers tokens from one account to another', async () => {
    // Given a mint account and two token accounts.
    // One with 100 tokens and the other with 0 tokens.
    const client = await createTestClient();
    const [mintAuthority, ownerA, ownerB, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    await client.token2022.instructions.createMint({ newMint: mint, mintAuthority }).sendTransaction();
    const [tokenA, tokenB] = await Promise.all([
        createTokenWithAmount({
            client,
            payer: client.payer,
            mintAuthority,
            mint: mint.address,
            owner: ownerA,
            amount: 100n,
        }),
        createToken({ client, payer: client.payer, mint: mint.address, owner: ownerB }),
    ]);

    // When owner A transfers 50 tokens to owner B.
    await client.token2022.instructions
        .transfer({ source: tokenA, destination: tokenB, authority: ownerA, amount: 50n })
        .sendTransaction();

    // Then we expect the mint and token accounts to have the following updated data.
    const [{ data: mintData }, { data: tokenDataA }, { data: tokenDataB }] = await Promise.all([
        fetchMint(client.rpc, mint.address),
        fetchToken(client.rpc, tokenA),
        fetchToken(client.rpc, tokenB),
    ]);
    expect(mintData).toMatchObject(<Mint>{ supply: 100n });
    expect(tokenDataA).toMatchObject(<Token>{ amount: 50n });
    expect(tokenDataB).toMatchObject(<Token>{ amount: 50n });
});
