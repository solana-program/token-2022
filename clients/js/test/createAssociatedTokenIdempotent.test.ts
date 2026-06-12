import { expect, it } from 'vitest';
import { Account, generateKeyPairSigner, none } from '@solana/kit';
import {
    AccountState,
    TOKEN_2022_PROGRAM_ADDRESS,
    Token,
    fetchToken,
    findAssociatedTokenPda,
    getCreateAssociatedTokenIdempotentInstructionAsync,
} from '../src';
import { createTestClient } from './_setup';

it('creates a new associated token account', async () => {
    // Given a mint account, its mint authority and a token owner.
    const client = await createTestClient();
    const [mintAuthority, owner, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    await client.token2022.instructions.createMint({ newMint: mint, mintAuthority }).sendTransaction();

    // When we create and initialize a token account at this address.
    const createAta = await getCreateAssociatedTokenIdempotentInstructionAsync({
        payer: client.payer,
        mint: mint.address,
        owner: owner.address,
    });
    await client.sendTransaction([createAta]);

    // Then we expect the token account to exist and have the following data.
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
            amount: 0n,
            delegate: none(),
            state: AccountState.Initialized,
            isNative: none(),
            delegatedAmount: 0n,
            closeAuthority: none(),
        },
    });
});
