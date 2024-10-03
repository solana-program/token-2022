import {
  Account,
  address,
  appendTransactionMessageInstructions,
  generateKeyPairSigner,
  none,
  pipe,
  some,
} from '@solana/web3.js';
import test from 'ava';
import {
  Mint,
  extension,
  fetchMint,
  getInitializeMintCloseAuthorityInstruction,
  getInitializeMintInstruction,
  getMintSize,
} from '../../src';
import {
  createDefaultSolanaClient,
  createDefaultTransaction,
  generateKeyPairSignerWithSol,
  getCreateToken22AccountInstruction,
  signAndSendTransaction,
} from '../_setup';

test('it initializes a mint account with a close authority', async (t) => {
  // Given an authority and a mint account.
  const client = createDefaultSolanaClient();
  const authority = await generateKeyPairSignerWithSol(client);
  const mint = await generateKeyPairSigner();

  // And a mint close authority extension.
  const mintCloseAuthorityExtension = extension('MintCloseAuthority', {
    closeAuthority: address('HHS1XymmkBpYAkg3XTbZLxgHa5n11PAWUCWdiVtRmzzS'),
  });

  // When we create and initialize a mint account with this extension.
  const space = getMintSize([mintCloseAuthorityExtension]);
  const instructions = [
    await getCreateToken22AccountInstruction(client, authority, mint, space),
    getInitializeMintCloseAuthorityInstruction({
      mint: mint.address,
      closeAuthority: mintCloseAuthorityExtension.closeAuthority,
    }),
    getInitializeMintInstruction({
      mint: mint.address,
      decimals: 2,
      mintAuthority: authority.address,
    }),
  ];
  await pipe(
    await createDefaultTransaction(client, authority),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
    (tx) => signAndSendTransaction(client, tx)
  );

  // Then we expect the mint account to exist and have the following data.
  const mintAccount = await fetchMint(client.rpc, mint.address);
  t.like(mintAccount, <Account<Mint>>{
    address: mint.address,
    data: {
      mintAuthority: some(authority.address),
      supply: 0n,
      decimals: 2,
      isInitialized: true,
      freezeAuthority: none(),
      extensions: some([
        {
          __kind: 'MintCloseAuthority',
          closeAuthority: address(
            'HHS1XymmkBpYAkg3XTbZLxgHa5n11PAWUCWdiVtRmzzS'
          ),
        },
      ]),
    },
  });
});
