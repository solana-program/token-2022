import { Account, address, generateKeyPairSigner, some } from '@solana/kit';
import test from 'ava';
import {
  Mint,
  extension,
  fetchMint,
  getUpdateMetadataPointerInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  createMint,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it updates the metadata pointer extension on a mint account', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, metadataPointerAuthority] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);
  const oldMetadata = address('8dtp4b6tB8EhLpSG1jgg4swSQtUKRst2f7rJYSwE2Me3');
  const newMetadata = address('88F35KbnWKPeMnKFJDxZVjvEWmGms1FxW6wP52VABCVt');

  // And a mint account initialized with a metadata pointer extension.
  const mint = await createMint({
    authority,
    client,
    extensions: [
      extension('MetadataPointer', {
        authority: metadataPointerAuthority.address,
        metadataAddress: oldMetadata,
      }),
    ],
    payer: authority,
  });

  // When we update the metadata pointer on the mint account.
  await sendAndConfirmInstructions(client, authority, [
    getUpdateMetadataPointerInstruction({
      mint,
      metadataPointerAuthority,
      metadataAddress: newMetadata,
    }),
  ]);

  // Then we expect the mint account to have the following updated data.
  const mintAccount = await fetchMint(client.rpc, mint);
  t.like(mintAccount, <Account<Mint>>{
    address: mint,
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
