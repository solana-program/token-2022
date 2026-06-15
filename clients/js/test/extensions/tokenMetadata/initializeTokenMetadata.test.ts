import { Account, generateKeyPairSigner, some } from '@solana/kit';
import { expect, it } from 'vitest';

import { Mint, extension, fetchMint } from '../../../src';
import { createTestClient } from '../../_setup';

it('initializes a mint account with a token metadata and metadata pointer extension', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, mint, updateAuthority] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a token metadata extension.
    const tokenMetadataExtension = extension('TokenMetadata', {
        updateAuthority: some(updateAuthority.address),
        mint: mint.address,
        name: 'My Super Token',
        symbol: 'MST',
        uri: 'https://example.com/mst.json',
        additionalMetadata: new Map<string, string>(),
    });

    // And a metadata pointer extension pointing to itself.
    const metadataPointerExtension = extension('MetadataPointer', {
        authority: some(authority.address),
        metadataAddress: some(mint.address),
    });

    // When we create and initialize a mint account with these extensions.
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            mintAuthority: authority,
            extensions: [metadataPointerExtension, tokenMetadataExtension],
        })
        .sendTransaction();

    // Then we expect the mint account to exist and have the following extension.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
        data: {
            extensions: some([metadataPointerExtension, tokenMetadataExtension]),
        },
    });
});
