import { Account, generateKeyPairSigner, some } from '@solana/kit';
import test from 'ava';
import {
  Mint,
  extension,
  fetchMint,
  getInitializeMetadataPointerInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it initializes a mint account with a metadata pointer extension', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, mint, metadata, metadataPointerAuthority] =
    await Promise.all([
      generateKeyPairSignerWithSol(client),
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
  const [createMintInstruction, initMintInstruction] =
    await getCreateMintInstructions({
      authority: authority.address,
      client,
      extensions: [metadataPointerExtension],
      mint,
      payer: authority,
    });
  await sendAndConfirmInstructions(client, authority, [
    createMintInstruction,
    getInitializeMetadataPointerInstruction({
      mint: mint.address,
      authority: metadataPointerExtension.authority,
      metadataAddress: metadataPointerExtension.metadataAddress,
    }),
    initMintInstruction,
  ]);

  // Then we expect the mint account to exist and have the following extension.
  const mintAccount = await fetchMint(client.rpc, mint.address);
  t.like(mintAccount, <Account<Mint>>{
    address: mint.address,
    data: {
      extensions: some([metadataPointerExtension]),
    },
  });
});
