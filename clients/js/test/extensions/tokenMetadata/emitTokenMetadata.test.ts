import { generateKeyPairSigner, getBase64Encoder } from '@solana/kit';
import test from 'ava';
import {
  extension,
  getEmitTokenMetadataInstruction,
  getExtensionEncoder,
} from '../../../src';
import {
  createDefaultSolanaClient,
  createMint,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it emits the token metadata extension as return data', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
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
  const signature = await sendAndConfirmInstructions(client, authority, [
    getEmitTokenMetadataInstruction({ metadata: mint.address }),
  ]);

  // Then we expect the token metadata extension to be emitted as return data.
  const transaction = await client.rpc
    .getTransaction(signature, { maxSupportedTransactionVersion: 0 })
    .send();
  const returnData = getBase64Encoder().encode(
    transaction?.meta?.returnData?.data?.[0] ?? ''
  );
  const expectedReturnData = getExtensionEncoder()
    .encode(tokenMetadataExtension)
    .slice(4); // Remove extension header.
  t.deepEqual(returnData, expectedReturnData);
});
