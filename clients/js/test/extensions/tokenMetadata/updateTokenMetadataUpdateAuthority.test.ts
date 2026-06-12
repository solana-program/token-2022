import { expect, it } from 'vitest';
import { generateKeyPairSigner, none, some, unwrapOption } from '@solana/kit';
import { extension, fetchMint, getUpdateTokenMetadataUpdateAuthorityInstruction, isExtension } from '../../../src';
import { createTestClient, createMint, generateKeyPairSignerWithSol } from '../../_setup';

it('updates the update authority of the token metadata extension', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, mint, updateAuthority, newUpdateAuthority] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a mint account initialized a token metadata extension.
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
                additionalMetadata: new Map(),
            }),
        ],
        mint,
        payer: authority,
    });

    // When we update the update authority of the token metadata extension.
    await client.sendTransaction([
        getUpdateTokenMetadataUpdateAuthorityInstruction({
            metadata: mint.address,
            updateAuthority: updateAuthority,
            newUpdateAuthority: newUpdateAuthority.address,
        }),
    ]);

    // Then we expect the new update authority to be set on the token metadata extension.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    const tokenMetadataExtension = unwrapOption(mintAccount.data.extensions)?.find(e =>
        isExtension('TokenMetadata', e),
    );
    expect(tokenMetadataExtension?.updateAuthority).toEqual(some(newUpdateAuthority.address));
});

it('removes the update authority of the token metadata extension', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, mint, updateAuthority] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a mint account initialized a token metadata extension.
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
                additionalMetadata: new Map(),
            }),
        ],
        mint,
        payer: authority,
    });

    // When we remove the update authority of the token metadata extension.
    await client.sendTransaction([
        getUpdateTokenMetadataUpdateAuthorityInstruction({
            metadata: mint.address,
            updateAuthority: updateAuthority,
            newUpdateAuthority: null,
        }),
    ]);

    // Then we expect token metadata extension to no longer have an update authority.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    const tokenMetadataExtension = unwrapOption(mintAccount.data.extensions)?.find(e =>
        isExtension('TokenMetadata', e),
    );
    expect(tokenMetadataExtension?.updateAuthority).toEqual(none());
});
