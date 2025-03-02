import { getCreateAccountInstruction } from '@solana-program/system';
import { Account, generateKeyPairSigner, none } from '@solana/kit';
import test from 'ava';
import {
  AccountState,
  TOKEN_2022_PROGRAM_ADDRESS,
  Token,
  fetchToken,
  getInitializeAccountInstruction,
  getTokenSize,
} from '../src';
import {
  createDefaultSolanaClient,
  createMint,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from './_setup';

test('it creates and initializes a new token account', async (t) => {
  // Given a mint account, its mint authority and two generated keypairs
  // for the token to be created and its owner.
  const client = createDefaultSolanaClient();
  const [payer, mintAuthority, token, owner] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);
  const mint = await createMint({ client, payer, authority: mintAuthority });

  // When we create and initialize a token account at this address.
  const space = BigInt(getTokenSize());
  const rent = await client.rpc.getMinimumBalanceForRentExemption(space).send();
  const instructions = [
    getCreateAccountInstruction({
      payer,
      newAccount: token,
      lamports: rent,
      space,
      programAddress: TOKEN_2022_PROGRAM_ADDRESS,
    }),
    getInitializeAccountInstruction({
      account: token.address,
      mint,
      owner: owner.address,
    }),
  ];
  await sendAndConfirmInstructions(client, payer, instructions);

  // Then we expect the token account to exist and have the following data.
  const tokenAccount = await fetchToken(client.rpc, token.address);
  t.like(tokenAccount, <Account<Token>>{
    address: token.address,
    data: {
      mint,
      owner: owner.address,
      amount: 0n,
      delegate: none(),
      state: AccountState.Initialized,
      isNative: none(),
      delegatedAmount: 0n,
      closeAuthority: none(),
    },
  });
});
