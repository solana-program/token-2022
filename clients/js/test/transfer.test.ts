import { expect, it } from 'vitest';
import { generateKeyPairSigner } from '@solana/kit';
import { Mint, Token, fetchMint, fetchToken, getTransferInstruction } from '../src';
import { createTestClient, createMint, createToken, createTokenWithAmount } from './_setup';

it('transfers tokens from one account to another', async () => {
    // Given a mint account and two token accounts.
    // One with 100 tokens and the other with 0 tokens.
    const client = await createTestClient();
    const [mintAuthority, ownerA, ownerB] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const mint = await createMint({ client, payer: client.payer, authority: mintAuthority });
    const [tokenA, tokenB] = await Promise.all([
        createTokenWithAmount({
            client,
            payer: client.payer,
            mintAuthority,
            mint,
            owner: ownerA,
            amount: 100n,
        }),
        createToken({ client, payer: client.payer, mint, owner: ownerB }),
    ]);

    // When owner A transfers 50 tokens to owner B.
    const transfer = getTransferInstruction({
        source: tokenA,
        destination: tokenB,
        authority: ownerA,
        amount: 50n,
    });
    await client.sendTransaction([transfer]);

    // Then we expect the mint and token accounts to have the following updated data.
    const [{ data: mintData }, { data: tokenDataA }, { data: tokenDataB }] = await Promise.all([
        fetchMint(client.rpc, mint),
        fetchToken(client.rpc, tokenA),
        fetchToken(client.rpc, tokenB),
    ]);
    expect(mintData).toMatchObject(<Mint>{ supply: 100n });
    expect(tokenDataA).toMatchObject(<Token>{ amount: 50n });
    expect(tokenDataB).toMatchObject(<Token>{ amount: 50n });
});
