import { expect, it } from 'vitest';
import { Account, address, generateKeyPairSigner, some } from '@solana/kit';
import { Mint, extension, fetchMint } from '../../../src';
import { createTestClient } from '../../_setup';

it('updates the metadata pointer extension on a mint account', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, metadataPointerAuthority, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const oldMetadata = address('8dtp4b6tB8EhLpSG1jgg4swSQtUKRst2f7rJYSwE2Me3');
    const newMetadata = address('88F35KbnWKPeMnKFJDxZVjvEWmGms1FxW6wP52VABCVt');

    // And a mint account initialized with a metadata pointer extension.
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            mintAuthority: authority,
            extensions: [
                extension('MetadataPointer', {
                    authority: metadataPointerAuthority.address,
                    metadataAddress: oldMetadata,
                }),
            ],
        })
        .sendTransaction();

    // When we update the metadata pointer on the mint account.
    await client.token2022.instructions
        .updateMetadataPointer({ mint: mint.address, metadataPointerAuthority, metadataAddress: newMetadata })
        .sendTransaction();

    // Then we expect the mint account to have the following updated data.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
        data: {
            extensions: some([
                extension('MetadataPointer', {
                    authority: some(metadataPointerAuthority.address),
                    metadataAddress: some(newMetadata),
                }),
            ]),
        },
    });
});
