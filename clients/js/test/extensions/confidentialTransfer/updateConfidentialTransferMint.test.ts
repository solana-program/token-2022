import {
  Account,
  address,
  generateKeyPairSigner,
  none,
  some,
} from '@solana/web3.js';
import test from 'ava';
import {
  Mint,
  extension,
  fetchMint,
  getInitializeConfidentialTransferMintInstruction,
  getUpdateConfidentialTransferMintInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it updates a mint account with confidential transfer', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, confidentialTransferAuthority, mint] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);

  // And a mint account initialized with a confidential transfer extension.
  const confidentialTransferExtension = extension('ConfidentialTransferMint', {
    authority: some(confidentialTransferAuthority.address),
    autoApproveNewAccounts: true,
    auditorElgamalPubkey: some(
      address('BTNEPmmWuj7Sg4Fo5i1FC5eiV2Aj4jiv9boarvE5XeaX')
    ),
  });
  const [createMintInstruction, initMintInstruction] =
    await getCreateMintInstructions({
      authority: authority.address,
      client,
      extensions: [confidentialTransferExtension],
      mint,
      payer: authority,
    });
  await sendAndConfirmInstructions(client, authority, [
    createMintInstruction,
    getInitializeConfidentialTransferMintInstruction({
      mint: mint.address,
      ...confidentialTransferExtension,
    }),
    initMintInstruction,
  ]);

  // When we update the mint account with new confidential transfer configs.
  await sendAndConfirmInstructions(client, authority, [
    getUpdateConfidentialTransferMintInstruction({
      mint: mint.address,
      authority: confidentialTransferAuthority,
      autoApproveNewAccounts: false,
      auditorElgamalPubkey: none(),
    }),
  ]);

  // Then we expect the mint account to have the following updated data.
  const mintAccount = await fetchMint(client.rpc, mint.address);
  t.like(mintAccount, <Account<Mint>>{
    address: mint.address,
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
