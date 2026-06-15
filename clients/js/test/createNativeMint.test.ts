import { Account, address, none } from '@solana/kit';
import { expect, it } from 'vitest';

import { Mint, fetchMint } from '../src';
import { createTestClient } from './_setup';

//Mint for native SOL Token accounts
const NATIVE_MINT = address('9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP');

it('creates a native mint account', async () => {
    // Given a client.
    const client = await createTestClient();

    // When we create a native mint account.
    await client.token2022.instructions
        .createNativeMint({ payer: client.payer, nativeMint: NATIVE_MINT })
        .sendTransaction();

    // Then we expect the native mint account to exist with the following data.
    const nativeMintAccount = await fetchMint(client.rpc, NATIVE_MINT);
    expect(nativeMintAccount).toMatchObject(<Account<Mint>>{
        address: NATIVE_MINT,
        data: {
            mintAuthority: none(), // Native mint has no mint authority
            supply: 0n,
            decimals: 9, // Native SOL has 9 decimals
            isInitialized: true,
            freezeAuthority: none(),
            extensions: none(), // Native mint doesn't have extensions
        },
    });
});
