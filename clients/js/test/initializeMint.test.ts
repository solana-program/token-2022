import { Account, generateKeyPairSigner, none, some } from '@solana/kit';
import test from 'ava';
import {
  Mint,
  TOKEN_2022_PROGRAM_ADDRESS,
  fetchMint,
  getInitializeMintInstruction,
  getMintSize,
} from '../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from './_setup';
import { getCreateAccountInstruction } from '@solana-program/system';

test('it creates and initializes a new mint account', async (t) => {
  // Given an authority and a mint account.
  const client = createDefaultSolanaClient();
  const [authority, mint] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

  // When we create and initialize a mint account at this address.
  const space = getMintSize();
  const rent = await client.rpc
    .getMinimumBalanceForRentExemption(BigInt(space))
    .send();
  await sendAndConfirmInstructions(client, authority, [
    getCreateAccountInstruction({
      payer: authority,
      newAccount: mint,
      lamports: rent,
      space,
      programAddress: TOKEN_2022_PROGRAM_ADDRESS,
    }),
    getInitializeMintInstruction({
      mint: mint.address,
      decimals: 2,
      mintAuthority: authority.address,
    }),
  ]);

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
  const rent = await client.rpc
    .getMinimumBalanceForRentExemption(BigInt(space))
    .send();
  await sendAndConfirmInstructions(client, payer, [
    getCreateAccountInstruction({
      payer,
      newAccount: mint,
      lamports: rent,
      space,
      programAddress: TOKEN_2022_PROGRAM_ADDRESS,
    }),
    getInitializeMintInstruction({
      mint: mint.address,
      decimals: 0,
      mintAuthority: mintAuthority.address,
      freezeAuthority: freezeAuthority.address,
    }),
  ]);

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
