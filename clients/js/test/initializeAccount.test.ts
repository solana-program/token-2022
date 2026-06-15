import { getCreateAccountInstruction } from '@solana-program/system';
import { Account, generateKeyPairSigner, none } from '@solana/kit';
import { expect, it } from 'vitest';

import {
    AccountState,
    TOKEN_2022_PROGRAM_ADDRESS,
    Token,
    fetchToken,
    getInitializeAccountInstruction,
    getTokenSize,
} from '../src';
import { createTestClient } from './_setup';

it('creates and initializes a new token account', async () => {
    // Given a mint account, its mint authority and two generated keypairs
    // for the token to be created and its owner.
    const client = await createTestClient();
    const [mintAuthority, token, owner, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    await client.token2022.instructions.createMint({ newMint: mint, mintAuthority }).sendTransaction();

    // When we create and initialize a token account at this address.
    const space = BigInt(getTokenSize());
    const rent = await client.rpc.getMinimumBalanceForRentExemption(space).send();
    const instructions = [
        getCreateAccountInstruction({
            payer: client.payer,
            newAccount: token,
            lamports: rent,
            space,
            programAddress: TOKEN_2022_PROGRAM_ADDRESS,
        }),
        getInitializeAccountInstruction({
            account: token.address,
            mint: mint.address,
            owner: owner.address,
        }),
    ];
    await client.sendTransaction(instructions);

    // Then we expect the token account to exist and have the following data.
    const tokenAccount = await fetchToken(client.rpc, token.address);
    expect(tokenAccount).toMatchObject(<Account<Token>>{
        address: token.address,
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
