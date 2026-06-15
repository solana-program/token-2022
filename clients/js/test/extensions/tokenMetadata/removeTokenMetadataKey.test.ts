import { generateKeyPairSigner, unwrapOption } from '@solana/kit';
import { expect, it } from 'vitest';

import { extension, fetchMint, isExtension, tokenMetadataField } from '../../../src';
import { createTestClient } from '../../_setup';

it('removes a custom field on the token metadata extension', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, mint, updateAuthority] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a mint account initialized with a token metadata extension that has a custom field.
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            mintAuthority: authority,
            extensions: [
                extension('MetadataPointer', {
                    authority: authority.address,
                    metadataAddress: mint.address,
                }),
                extension('TokenMetadata', {
                    updateAuthority: updateAuthority.address,
                    mint: mint.address,
                    name: 'My Super Token',
                    symbol: 'MST',
                    uri: 'https://example.com/mst.json',
                    additionalMetadata: new Map<string, string>([['CustomField', 'CustomValue']]),
                }),
            ],
        })
        .sendTransaction();
    await client.token2022.instructions
        .updateTokenMetadataField({
            metadata: mint.address,
            updateAuthority,
            field: tokenMetadataField('Key', ['CustomField']),
            value: 'CustomValue',
        })
        .sendTransaction();

    // When we remove the custom field from the token metadata extension.
    await client.token2022.instructions
        .removeTokenMetadataKey({ metadata: mint.address, updateAuthority, key: 'CustomField' })
        .sendTransaction();

    // Then we expect the token metadata extension to no longer have custom fields.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    const tokenMetadataExtension = unwrapOption(mintAccount.data.extensions)?.find(e =>
        isExtension('TokenMetadata', e),
    );
    expect(tokenMetadataExtension?.additionalMetadata).toEqual(new Map());
});
