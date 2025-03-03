import { Account, address, none } from '@solana/kit';
import test from 'ava';
import { Mint, fetchMint, getCreateNativeMintInstruction } from '../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from './_setup';

//Mint for native SOL Token accounts
const NATIVE_MINT = address('9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP');

test('it creates a native mint account', async (t) => {
  // Given a payer account.
  const client = createDefaultSolanaClient();
  const payer = await generateKeyPairSignerWithSol(client);

  // When we create a native mint account.
  await sendAndConfirmInstructions(client, payer, [
    getCreateNativeMintInstruction({
      payer: payer,
      nativeMint: NATIVE_MINT,
    }),
  ]);

  // Then we expect the native mint account to exist with the following data.
  const nativeMintAccount = await fetchMint(client.rpc, NATIVE_MINT);
  t.like(nativeMintAccount, <Account<Mint>>{
    address: NATIVE_MINT,
    data: {
      mintAuthority: none(), // Native mint has no mint authority
      supply: 0n,
      decimals: 9, // Native SOL has 9 decimals
      isInitialized: true,
      freezeAuthority: none(),
      extensions: none(), // Native mint doesn't have extensions
    },
  });
});
