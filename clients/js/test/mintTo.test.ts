import { generateKeyPairSigner } from '@solana/kit';
import test from 'ava';
import {
  Mint,
  Token,
  fetchMint,
  fetchToken,
  getMintToInstruction,
} from '../src';
import {
  createDefaultSolanaClient,
  createMint,
  createToken,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from './_setup';

test('it mints tokens to a token account', async (t) => {
  // Given a mint account and a token account.
  const client = createDefaultSolanaClient();
  const [payer, mintAuthority, owner] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);
  const mint = await createMint({ client, payer, authority: mintAuthority });
  const token = await createToken({ client, payer, mint, owner });

  // When the mint authority mints tokens to the token account.
  const mintTo = getMintToInstruction({
    mint,
    token,
    mintAuthority,
    amount: 100n,
  });
  await sendAndConfirmInstructions(client, payer, [mintTo]);

  // Then we expect the mint and token accounts to have the following updated data.
  const [{ data: mintData }, { data: tokenData }] = await Promise.all([
    fetchMint(client.rpc, mint),
    fetchToken(client.rpc, token),
  ]);
  t.like(mintData, <Mint>{ supply: 100n });
  t.like(tokenData, <Token>{ amount: 100n });
});
