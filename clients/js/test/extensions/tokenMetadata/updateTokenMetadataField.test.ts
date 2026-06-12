import { expect, it } from 'vitest';
import { generateKeyPairSigner, unwrapOption } from '@solana/kit';
import {
    extension,
    fetchMint,
    getUpdateTokenMetadataFieldInstruction,
    isExtension,
    tokenMetadataField,
} from '../../../src';
import { createTestClient, createMint, generateKeyPairSignerWithSol } from '../../_setup';

it('updates a known field on the token metadata extension', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, mint, updateAuthority] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a mint account initialized with the token metadata and metadata pointer extensions.
    await createMint({
        authority,
        client,
        extensions: [
            extension('MetadataPointer', {
                authority: authority.address,
                metadataAddress: mint.address,
            }),
            extension('TokenMetadata', {
                updateAuthority: updateAuthority.address,
                mint: mint.address,
                name: 'My OLD Token Name',
                symbol: 'MST',
                uri: 'https://example.com/mst.json',
                additionalMetadata: new Map<string, string>(),
            }),
        ],
        mint,
        payer: authority,
    });

    // When we change the name of the token metadata extension.
    await client.sendTransaction([
        getUpdateTokenMetadataFieldInstruction({
            metadata: mint.address,
            updateAuthority: updateAuthority,
            field: tokenMetadataField('Name'),
            value: 'My NEW Token Name',
        }),
    ]);

    // Then we expect the token metadata extension to have the new name.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    const tokenMetadataExtension = unwrapOption(mintAccount.data.extensions)?.find(e =>
        isExtension('TokenMetadata', e),
    );
    expect(tokenMetadataExtension?.name).toBe('My NEW Token Name');
});

it('updates a custom field on the token metadata extension', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, mint, updateAuthority] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a mint account initialized with the token metadata and metadata pointer
    // extension such that the additional metadata field is set to a custom key/value
    // pair in order to know the size of mint account data before updating the field.
    await createMint({
        authority,
        client,
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
                additionalMetadata: new Map<string, string>([
                    // This is important to know how much rent to pay at this stage.
                    ['CustomField', 'CustomValue'],
                ]),
            }),
        ],
        mint,
        payer: authority,
    });

    // When we set the custom field on the token metadata extension.
    await client.sendTransaction([
        getUpdateTokenMetadataFieldInstruction({
            metadata: mint.address,
            updateAuthority: updateAuthority,
            field: tokenMetadataField('Key', ['CustomField']),
            value: 'CustomValue',
        }),
    ]);

    // Then we expect the token metadata extension to have the new custom field.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    const tokenMetadataExtension = unwrapOption(mintAccount.data.extensions)?.find(e =>
        isExtension('TokenMetadata', e),
    );
    expect(tokenMetadataExtension?.additionalMetadata).toEqual(new Map([['CustomField', 'CustomValue']]));
});
