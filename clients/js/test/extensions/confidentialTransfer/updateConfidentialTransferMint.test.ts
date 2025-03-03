import {
  Account,
  address,
  generateKeyPairSigner,
  none,
  some,
} from '@solana/kit';
import test from 'ava';
import {
  Mint,
  extension,
  fetchMint,
  getUpdateConfidentialTransferMintInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  createMint,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it updates a mint account with confidential transfer', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, confidentialTransferAuthority] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

  // And a mint account initialized with a confidential transfer extension.
  const mint = await createMint({
    authority,
    client,
    extensions: [
      extension('ConfidentialTransferMint', {
        authority: some(confidentialTransferAuthority.address),
        autoApproveNewAccounts: true,
        auditorElgamalPubkey: some(
          address('BTNEPmmWuj7Sg4Fo5i1FC5eiV2Aj4jiv9boarvE5XeaX')
        ),
      }),
    ],
    payer: authority,
  });

  // When we update the mint account with new confidential transfer configs.
  await sendAndConfirmInstructions(client, authority, [
    getUpdateConfidentialTransferMintInstruction({
      mint,
      authority: confidentialTransferAuthority,
      autoApproveNewAccounts: false,
      auditorElgamalPubkey: none(),
    }),
  ]);

  // Then we expect the mint account to have the following updated data.
  const mintAccount = await fetchMint(client.rpc, mint);
  t.like(mintAccount, <Account<Mint>>{
    address: mint,
    data: {
      mintAuthority: some(authority.address),
      extensions: some([
        extension('ConfidentialTransferMint', {
          authority: some(confidentialTransferAuthority.address),
          autoApproveNewAccounts: false,
          auditorElgamalPubkey: none(),
        }),
      ]),
    },
  });
});
