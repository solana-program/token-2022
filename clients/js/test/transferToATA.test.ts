import { generateKeyPairSigner } from '@solana/kit';
import { expect, it } from 'vitest';
import { Mint, TOKEN_2022_PROGRAM_ADDRESS, Token, fetchMint, fetchToken, findAssociatedTokenPda } from '../src';
import { createTestClient, createTokenPdaWithAmount, createTokenWithAmount } from './_setup';

it('transfers tokens from an explicit source to an explicit destination ATA', async () => {
    // Given a mint account, one token account with 100 tokens, and a second owner.
    const client = await createTestClient();
    const [mintAuthority, ownerA, ownerB, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const decimals = 2;
    await client.token2022.instructions.createMint({ newMint: mint, decimals, mintAuthority }).sendTransaction();
    const tokenA = await createTokenWithAmount({
        client,
        payer: client.payer,
        mint: mint.address,
        owner: ownerA,
        mintAuthority,
        amount: 100n,
    });
    const [tokenB] = await findAssociatedTokenPda({
        owner: ownerB.address,
        mint: mint.address,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });

    // When owner A transfers 50 tokens to owner B.
    await client.token2022.instructions
        .transferToATA({
            mint: mint.address,
            source: tokenA,
            authority: ownerA,
            destination: tokenB,
            recipient: ownerB.address,
            amount: 50n,
            decimals,
        })
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

it('derives a new destination ATA and transfers tokens to it', async () => {
    // Given a mint account, one token account with 100 tokens, and a second owner.
    const client = await createTestClient();
    const [mintAuthority, ownerA, ownerB, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const decimals = 2;
    await client.token2022.instructions.createMint({ newMint: mint, decimals, mintAuthority }).sendTransaction();
    const tokenA = await createTokenWithAmount({
        client,
        payer: client.payer,
        mint: mint.address,
        owner: ownerA,
        mintAuthority,
        amount: 100n,
    });

    // When owner A transfers 50 tokens to owner B, with the destination derived.
    await client.token2022.instructions
        .transferToATA({
            mint: mint.address,
            source: tokenA,
            authority: ownerA,
            recipient: ownerB.address,
            amount: 50n,
            decimals,
        })
        .sendTransaction();

    // Then we expect the mint and token accounts to have the following updated data.
    const [tokenB] = await findAssociatedTokenPda({
        owner: ownerB.address,
        mint: mint.address,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });
    const [{ data: mintData }, { data: tokenDataA }, { data: tokenDataB }] = await Promise.all([
        fetchMint(client.rpc, mint.address),
        fetchToken(client.rpc, tokenA),
        fetchToken(client.rpc, tokenB),
    ]);
    expect(mintData).toMatchObject(<Mint>{ supply: 100n });
    expect(tokenDataA).toMatchObject(<Token>{ amount: 50n });
    expect(tokenDataB).toMatchObject(<Token>{ amount: 50n });
});

it('derives both source and destination ATAs and transfers tokens', async () => {
    // Given a mint account and ownerA's ATA with 100 tokens.
    const client = await createTestClient();
    const [mintAuthority, ownerA, ownerB, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const decimals = 2;
    await client.token2022.instructions.createMint({ newMint: mint, decimals, mintAuthority }).sendTransaction();
    const tokenA = await createTokenPdaWithAmount({
        client,
        mint: mint.address,
        mintAuthority,
        owner: ownerA.address,
        amount: 100n,
        decimals,
    });

    // When owner A transfers 50 tokens to owner B without specifying source or destination.
    await client.token2022.instructions
        .transferToATA({ mint: mint.address, authority: ownerA, recipient: ownerB.address, amount: 50n, decimals })
        .sendTransaction();

    // Then we expect both ATAs to have the correct balances.
    const [tokenB] = await findAssociatedTokenPda({
        owner: ownerB.address,
        mint: mint.address,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });
    const [{ data: mintData }, { data: tokenDataA }, { data: tokenDataB }] = await Promise.all([
        fetchMint(client.rpc, mint.address),
        fetchToken(client.rpc, tokenA),
        fetchToken(client.rpc, tokenB),
    ]);
    expect(mintData).toMatchObject(<Mint>{ supply: 100n });
    expect(tokenDataA).toMatchObject(<Token>{ amount: 50n });
    expect(tokenDataB).toMatchObject(<Token>{ amount: 50n });
});
