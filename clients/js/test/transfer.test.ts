import { generateKeyPairSigner } from '@solana/kit';
import test from 'ava';
import {
  Mint,
  Token,
  fetchMint,
  fetchToken,
  getTransferInstruction,
} from '../src';
import {
  createDefaultSolanaClient,
  createMint,
  createToken,
  createTokenWithAmount,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from './_setup';

test('it transfers tokens from one account to another', async (t) => {
  // Given a mint account and two token accounts.
  // One with 100 tokens and the other with 0 tokens.
  const client = createDefaultSolanaClient();
  const [payer, mintAuthority, ownerA, ownerB] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);
  const mint = await createMint({ client, payer, authority: mintAuthority });
  const [tokenA, tokenB] = await Promise.all([
    createTokenWithAmount({
      client,
      payer,
      mintAuthority,
      mint,
      owner: ownerA,
      amount: 100n,
    }),
    createToken({ client, payer, mint, owner: ownerB }),
  ]);

  // When owner A transfers 50 tokens to owner B.
  const transfer = getTransferInstruction({
    source: tokenA,
    destination: tokenB,
    authority: ownerA,
    amount: 50n,
  });
  await sendAndConfirmInstructions(client, payer, [transfer]);

  // Then we expect the mint and token accounts to have the following updated data.
  const [{ data: mintData }, { data: tokenDataA }, { data: tokenDataB }] =
    await Promise.all([
      fetchMint(client.rpc, mint),
      fetchToken(client.rpc, tokenA),
      fetchToken(client.rpc, tokenB),
    ]);
  t.like(mintData, <Mint>{ supply: 100n });
  t.like(tokenDataA, <Token>{ amount: 50n });
  t.like(tokenDataB, <Token>{ amount: 50n });
});
