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
