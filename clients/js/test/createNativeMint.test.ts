import { Account, address, none } from '@solana/web3.js';
import test from 'ava';
import { Mint, fetchMint, getCreateNativeMintInstruction } from '../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from './_setup';

// Define the native SOL Token mint address
const SOL_MINT_ADDRESS = address(
  '9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP'
);

test('it successfully initializes a native mint account', async (t) => {
  // Setup: create a Solana client and payer account
  const solanaClient = createDefaultSolanaClient();
  const payerKeyPair = await generateKeyPairSignerWithSol(solanaClient);

  // Action: create the native mint account using the instruction
  await sendAndConfirmInstructions(solanaClient, payerKeyPair, [
    getCreateNativeMintInstruction({
      payer: payerKeyPair,
      nativeMint: SOL_MINT_ADDRESS,
    }),
  ]);

  // Verification: check if the mint account exists with the expected data
  const mintAccount = await fetchMint(solanaClient.rpc, SOL_MINT_ADDRESS);
  t.like(mintAccount, <Account<Mint>>{
    address: SOL_MINT_ADDRESS,
    data: {
      mintAuthority: none(), // No authority for native mint
      supply: 0n,
      decimals: 9, // 9 decimals for SOL
      isInitialized: true,
      freezeAuthority: none(),
      extensions: none(), // No extensions for the native mint
    },
  });
});

test('it throws an error when trying to create a native mint that already exists', async (t) => {
  // Setup: create a Solana client and payer account
  const solanaClient = createDefaultSolanaClient();
  const payerKeyPair = await generateKeyPairSignerWithSol(solanaClient);

  // Action: create the native mint account for the first time
  await sendAndConfirmInstructions(solanaClient, payerKeyPair, [
    getCreateNativeMintInstruction({
      payer: payerKeyPair,
      nativeMint: SOL_MINT_ADDRESS,
    }),
  ]);

  // Attempt to create the same native mint again
  const duplicateCreationAttempt = sendAndConfirmInstructions(
    solanaClient,
    payerKeyPair,
    [
      getCreateNativeMintInstruction({
        payer: payerKeyPair,
        nativeMint: SOL_MINT_ADDRESS,
      }),
    ]
  );

  // Verification: expect the operation to fail since the mint account already exists
  await t.throwsAsync(duplicateCreationAttempt, {
    message: /Account already exists/,
  });
});

test('it ensures the mintAuthority is none for native mint', async (t) => {
  // Given: a Solana client and payer account
  const solanaClient = createDefaultSolanaClient();
  const payerKeyPair = await generateKeyPairSignerWithSol(solanaClient);

  // When: we create the native mint account
  await sendAndConfirmInstructions(solanaClient, payerKeyPair, [
    getCreateNativeMintInstruction({
      payer: payerKeyPair,
      nativeMint: SOL_MINT_ADDRESS,
    }),
  ]);

  // Then: check that mintAuthority is none
  const mintAccount = await fetchMint(solanaClient.rpc, SOL_MINT_ADDRESS);
  t.is(mintAccount.data.mintAuthority, none());
});

test('it fails to fetch mint account before creation', async (t) => {
  // Given: a Solana client and payer account
  const solanaClient = createDefaultSolanaClient();
  const payerKeyPair = await generateKeyPairSignerWithSol(solanaClient);

  // When: we try to fetch the mint account before it's created
  const promise = fetchMint(solanaClient.rpc, SOL_MINT_ADDRESS);

  // Then: we expect it to fail with an error saying the account doesn't exist
  await t.throwsAsync(promise, {
    message: /Account does not exist/,
  });
});
