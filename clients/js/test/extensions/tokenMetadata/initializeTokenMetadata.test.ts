import { Account, generateKeyPairSigner, some } from '@solana/kit';
import test from 'ava';
import {
  Mint,
  extension,
  fetchMint,
  getInitializeMetadataPointerInstruction,
  getInitializeTokenMetadataInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it initializes a mint account with a token metadata and metadata pointer extension', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, mint, updateAuthority] = await Promise.all([
    generateKeyPairSignerWithSol(client),
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
  const [createMintInstruction, initMintInstruction] =
    await getCreateMintInstructions({
      authority: authority.address,
      client,
      extensions: [metadataPointerExtension, tokenMetadataExtension],
      mint,
      payer: authority,
    });
  await sendAndConfirmInstructions(client, authority, [
    createMintInstruction,
    getInitializeMetadataPointerInstruction({
      mint: mint.address,
      authority: authority.address,
      metadataAddress: mint.address,
    }),
    initMintInstruction,
    getInitializeTokenMetadataInstruction({
      metadata: mint.address,
      updateAuthority: updateAuthority.address,
      mint: mint.address,
      mintAuthority: authority,
      name: tokenMetadataExtension.name,
      symbol: tokenMetadataExtension.symbol,
      uri: tokenMetadataExtension.uri,
    }),
  ]);

  // Then we expect the mint account to exist and have the following extension.
  const mintAccount = await fetchMint(client.rpc, mint.address);
  t.like(mintAccount, <Account<Mint>>{
    address: mint.address,
    data: {
      extensions: some([metadataPointerExtension, tokenMetadataExtension]),
    },
  });
});
