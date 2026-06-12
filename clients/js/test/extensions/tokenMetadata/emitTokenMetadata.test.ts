import { expect, it } from 'vitest';
import { generateKeyPairSigner } from '@solana/kit';
import { extension, getEmitTokenMetadataInstruction, getExtensionEncoder } from '../../../src';
import { createTestClient, createMint, generateKeyPairSignerWithSol, getSingleTransactionContext } from '../../_setup';

it('emits the token metadata extension as return data', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, mint, updateAuthority] = await Promise.all([
        generateKeyPairSignerWithSol(client),
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
    await createMint({
        authority,
        client,
        extensions: [
            extension('MetadataPointer', {
                authority: authority.address,
                metadataAddress: mint.address,
            }),
            tokenMetadataExtension,
        ],
        mint,
        payer: authority,
    });

    // When we emit the token metadata extension.
    const result = await client.sendTransaction([getEmitTokenMetadataInstruction({ metadata: mint.address })]);

    // Then we expect the token metadata extension to be emitted as return data.
    const returnData = getSingleTransactionContext(result).transactionMetadata.returnData().data();
    const expectedReturnData = getExtensionEncoder().encode(tokenMetadataExtension).slice(4); // Remove extension header.
    expect(returnData).toStrictEqual(expectedReturnData);
});
