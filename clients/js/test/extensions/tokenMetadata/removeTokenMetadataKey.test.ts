import { generateKeyPairSigner, unwrapOption } from '@solana/kit';
import test from 'ava';
import {
  extension,
  fetchMint,
  getRemoveTokenMetadataKeyInstruction,
  getUpdateTokenMetadataFieldInstruction,
  isExtension,
  tokenMetadataField,
} from '../../../src';
import {
  createDefaultSolanaClient,
  createMint,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it removes a custom field on the token metadata extension', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, mint, updateAuthority] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);

  // And a mint account initialized with a token metadata extension that has a custom field.
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
          ['CustomField', 'CustomValue'],
        ]),
      }),
    ],
    mint,
    payer: authority,
  });
  await sendAndConfirmInstructions(client, authority, [
    getUpdateTokenMetadataFieldInstruction({
      metadata: mint.address,
      updateAuthority: updateAuthority,
      field: tokenMetadataField('Key', ['CustomField']),
      value: 'CustomValue',
    }),
  ]);

  // When we remove the custom field from the token metadata extension.
  await sendAndConfirmInstructions(client, authority, [
    getRemoveTokenMetadataKeyInstruction({
      metadata: mint.address,
      updateAuthority: updateAuthority,
      key: 'CustomField',
    }),
  ]);

  // Then we expect the token metadata extension to no longer have custom fields.
  const mintAccount = await fetchMint(client.rpc, mint.address);
  const tokenMetadataExtension = unwrapOption(
    mintAccount.data.extensions
  )?.find((e) => isExtension('TokenMetadata', e));
  t.deepEqual(tokenMetadataExtension?.additionalMetadata, new Map());
});
