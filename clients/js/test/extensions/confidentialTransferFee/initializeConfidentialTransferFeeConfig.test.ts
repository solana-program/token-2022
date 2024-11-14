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
  getInitializeConfidentialTransferFeeConfigInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it initializes a mint account with confidential transfer fee configurations', async (t) => {
  const client = createDefaultSolanaClient();
  const [authority, mint] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

  const confidentialTransferFeeConfigExtension = extension(
    'ConfidentialTransferFee',
    {
      authority: some(authority.address),
      elgamalPubkey: address('ENFvQcBnPT599PsYBcKwa8wRFiyWcDYiELvZ7bdvQWPp'),
    }
  );

  const [createMintInstruction, initMintInstruction] =
    await getCreateMintInstructions({
      authority: authority.address,
      client,
      decimals: 2,
      extensions: [confidentialTransferFeeConfigExtension],
      mint,
      payer: authority,
    });
  await sendAndConfirmInstructions(client, authority, [
    createMintInstruction,
    getInitializeConfidentialTransferFeeConfigInstruction({
      mint: mint.address,
      authority: some(authority.address),
      withdrawWithheldAuthorityElgamalPubkey: address(
        'ENFvQcBnPT599PsYBcKwa8wRFiyWcDYiELvZ7bdvQWPp'
      ),
    }),
    initMintInstruction,
  ]);

  const mintAccount = await fetchMint(client.rpc, mint.address);
  t.like(mintAccount, <Account<Mint>>{
    address: mint.address,
    data: {
      mintAuthority: some(authority.address),
      isInitialized: true,
      freezeAuthority: none(),
      extensions: some([confidentialTransferFeeConfigExtension]),
    },
  });
});
