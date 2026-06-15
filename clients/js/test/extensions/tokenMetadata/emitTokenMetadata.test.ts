import { generateKeyPairSigner } from '@solana/kit';
import { expect, it } from 'vitest';

import { extension, getExtensionEncoder } from '../../../src';
import { createTestClient, getSingleTransactionContext } from '../../_setup';

it('emits the token metadata extension as return data', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, mint, updateAuthority] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a mint account initialized a token metadata extension.
    const tokenMetadataExtension = extension('TokenMetadata', {
        updateAuthority: updateAuthority.address,
        mint: mint.address,
        name: 'My Super Token',
        symbol: 'MST',
        uri: 'https://example.com/mst.json',
        additionalMetadata: new Map(),
    });
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            mintAuthority: authority,
            extensions: [
                extension('MetadataPointer', {
                    authority: authority.address,
                    metadataAddress: mint.address,
                }),
                tokenMetadataExtension,
            ],
        })
        .sendTransaction();

    // When we emit the token metadata extension.
    const result = await client.token2022.instructions.emitTokenMetadata({ metadata: mint.address }).sendTransaction();

    // Then we expect the token metadata extension to be emitted as return data.
    const returnData = getSingleTransactionContext(result).transactionMetadata.returnData().data();
    const expectedReturnData = getExtensionEncoder().encode(tokenMetadataExtension).slice(4); // Remove extension header.
    expect(returnData).toStrictEqual(expectedReturnData);
});
