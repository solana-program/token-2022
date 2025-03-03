import { Account, generateKeyPairSigner, none } from '@solana/kit';
import test from 'ava';
import {
  AccountState,
  TOKEN_2022_PROGRAM_ADDRESS,
  Token,
  fetchToken,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
} from '../src';
import {
  createDefaultSolanaClient,
  createMint,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from './_setup';

test('it creates a new associated token account', async (t) => {
  // Given a mint account, its mint authority and a token owner.
  const client = createDefaultSolanaClient();
  const [payer, mintAuthority, owner] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);
  const mint = await createMint({ client, payer, authority: mintAuthority });

  // When we create and initialize a token account at this address.
  const createAta = await getCreateAssociatedTokenIdempotentInstructionAsync({
    payer,
    mint,
    owner: owner.address,
  });
  await sendAndConfirmInstructions(client, payer, [createAta]);

  // Then we expect the token account to exist and have the following data.
  const [ata] = await findAssociatedTokenPda({
    mint,
    owner: owner.address,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });
  t.like(await fetchToken(client.rpc, ata), <Account<Token>>{
    address: ata,
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
