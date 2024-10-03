import {
  Account,
  appendTransactionMessageInstructions,
  generateKeyPairSigner,
  none,
  pipe,
  some,
} from '@solana/web3.js';
import test from 'ava';
import {
  Mint,
  fetchMint,
  getInitializeMintInstruction,
  getMintSize,
} from '../src';
import {
  createDefaultSolanaClient,
  createDefaultTransaction,
  generateKeyPairSignerWithSol,
  getCreateToken22AccountInstruction,
  signAndSendTransaction,
} from './_setup';

test('it creates and initializes a new mint account', async (t) => {
  // Given an authority and a mint account.
  const client = createDefaultSolanaClient();
  const authority = await generateKeyPairSignerWithSol(client);
  const mint = await generateKeyPairSigner();

  // When we create and initialize a mint account at this address.
  const space = getMintSize();
  const instructions = [
    await getCreateToken22AccountInstruction(client, authority, mint, space),
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
    },
  });
});

test('it creates a new mint account with a freeze authority', async (t) => {
  // Given an authority and a mint account.
  const client = createDefaultSolanaClient();
  const [payer, mintAuthority, freezeAuthority, mint] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);

  // When we create and initialize a mint account at this address.
  const space = getMintSize();
  const instructions = [
    await getCreateToken22AccountInstruction(client, payer, mint, space),
    getInitializeMintInstruction({
      mint: mint.address,
      decimals: 0,
      mintAuthority: mintAuthority.address,
      freezeAuthority: freezeAuthority.address,
    }),
  ];
  await pipe(
    await createDefaultTransaction(client, payer),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
    (tx) => signAndSendTransaction(client, tx)
  );

  // Then we expect the mint account to exist and have the following data.
  const mintAccount = await fetchMint(client.rpc, mint.address);
  t.like(mintAccount, <Account<Mint>>{
    address: mint.address,
    data: {
      mintAuthority: some(mintAuthority.address),
      freezeAuthority: some(freezeAuthority.address),
    },
  });
});
