import { Account, generateKeyPairSigner, some } from '@solana/kit';
import { expect, it } from 'vitest';

import { Mint, extension, fetchMint } from '../../../src';
import { createTestClient } from '../../_setup';

it('initializes a mint account with a metadata pointer extension', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, mint, metadata, metadataPointerAuthority] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a metadata pointer extension.
    const metadataPointerExtension = extension('MetadataPointer', {
        authority: some(metadataPointerAuthority.address),
        metadataAddress: some(metadata.address),
    });

    // When we create and initialize a mint account with this extension.
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            mintAuthority: authority,
            extensions: [metadataPointerExtension],
        })
        .sendTransaction();

    // Then we expect the mint account to exist and have the following extension.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
        data: {
            extensions: some([metadataPointerExtension]),
        },
    });
});
