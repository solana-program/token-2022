import { Account, generateKeyPairSigner, some } from '@solana/kit';
import { expect, it } from 'vitest';

import { Mint, extension, fetchMint } from '../../../src';
import { createTestClient } from '../../_setup';

it('initializes a mint account with a token group and group pointer extension', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, mint, updateAuthority] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a token group extension.
    const tokenGroupExtension = extension('TokenGroup', {
        updateAuthority: some(updateAuthority.address),
        mint: mint.address,
        size: 0n,
        maxSize: 20_000n,
    });

    // And a group pointer extension pointing to itself.
    const groupPointerExtension = extension('GroupPointer', {
        authority: some(authority.address),
        groupAddress: some(mint.address),
    });

    // When we create and initialize a mint account with these extensions.
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            mintAuthority: authority,
            extensions: [groupPointerExtension, tokenGroupExtension],
        })
        .sendTransaction();

    // Then we expect the mint account to exist and have the following extension.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
        data: {
            extensions: some([groupPointerExtension, tokenGroupExtension]),
        },
    });
});
