import { Account, generateKeyPairSigner, none } from '@solana/kit';
import { expect, it } from 'vitest';

import { AccountState, TOKEN_2022_PROGRAM_ADDRESS, Token, fetchToken, findAssociatedTokenPda } from '../src';
import { createTestClient } from './_setup';

it('mints to an associated token account at an explicit address', async () => {
    // Given a mint account, its mint authority, a token owner and the ATA.
    const client = await createTestClient();
    const [mintAuthority, owner, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const decimals = 2;
    await client.token2022.instructions.createMint({ newMint: mint, decimals, mintAuthority }).sendTransaction();
    const [ata] = await findAssociatedTokenPda({
        mint: mint.address,
        owner: owner.address,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });

    // When we mint to the explicit ATA.
    await client.token2022.instructions
        .mintToATA({ ata, mint: mint.address, owner: owner.address, mintAuthority, amount: 1_000n, decimals })
        .sendTransaction();

    // Then we expect the token account to exist and have the following data.
    expect(await fetchToken(client.rpc, ata)).toMatchObject(<Account<Token>>{
        address: ata,
        data: {
            mint: mint.address,
            owner: owner.address,
            amount: 1000n,
            delegate: none(),
            state: AccountState.Initialized,
            isNative: none(),
            delegatedAmount: 0n,
            closeAuthority: none(),
        },
    });
});

it('mints to an associated token account that it auto-derives', async () => {
    // Given a mint account, its mint authority and a token owner.
    const client = await createTestClient();
    const [mintAuthority, owner, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const decimals = 2;
    await client.token2022.instructions.createMint({ newMint: mint, decimals, mintAuthority }).sendTransaction();

    // When we mint to the owner, with the ATA auto-derived.
    await client.token2022.instructions
        .mintToATA({ mint: mint.address, owner: owner.address, mintAuthority, amount: 1_000n, decimals })
        .sendTransaction();

    // Then we expect the derived ATA to exist and have the following data.
    const [ata] = await findAssociatedTokenPda({
        mint: mint.address,
        owner: owner.address,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });
    expect(await fetchToken(client.rpc, ata)).toMatchObject(<Account<Token>>{
        address: ata,
        data: {
            mint: mint.address,
            owner: owner.address,
            amount: 1000n,
        },
    });
});

it('also mints to an existing associated token account', async () => {
    // Given a mint account, its mint authority, a token owner and the ATA.
    const client = await createTestClient();
    const [mintAuthority, owner, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const decimals = 2;
    await client.token2022.instructions.createMint({ newMint: mint, decimals, mintAuthority }).sendTransaction();
    const [ata] = await findAssociatedTokenPda({
        mint: mint.address,
        owner: owner.address,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });

    // When we mint to the ATA a first time.
    await client.token2022.instructions
        .mintToATA({ ata, mint: mint.address, owner: owner.address, mintAuthority, amount: 1_000n, decimals })
        .sendTransaction();

    // Expire the blockhash so the next (otherwise identical) transaction has a
    // distinct signature in LiteSVM, which has no passage of time of its own.
    client.svm.expireBlockhash();

    // And then we mint additional tokens to the same account.
    await client.token2022.instructions
        .mintToATA({ ata, mint: mint.address, owner: owner.address, mintAuthority, amount: 1_000n, decimals })
        .sendTransaction();

    // Then we expect the token account to have the accumulated amount.
    expect(await fetchToken(client.rpc, ata)).toMatchObject(<Account<Token>>{
        address: ata,
        data: {
            mint: mint.address,
            owner: owner.address,
            amount: 2000n,
        },
    });
});
