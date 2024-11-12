import { generateKeyPairSigner, none,PublicKey } from '@solana/web3.js';
import test from 'ava';
import {
  AccountState,
  TOKEN_2022_PROGRAM_ADDRESS,
  Token,
  fetchToken,
  findAssociatedTokenPda,
  getCreateAssociatedTokenInstructionAsync,
  getMintToInstruction,
  getWithdrawExcessLamportsInstruction,
} from '../src';
import {
  createDefaultSolanaClient,
  createMint,
  createToken,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from './_setup';

test('withdraw excess lamports from an associated token account', async (t) => {
  const client = createDefaultSolanaClient();
  const [payer, mintAuthority, owner, destination] = await Promise.all([
    generateKeyPairSignerWithSol(client,200_000_000n),
    generateKeyPairSignerWithSol(client),
    generateKeyPairSignerWithSol(client),
    generateKeyPairSignerWithSol(client,200_000_000n),
  ]);

  // Step 1: Create an SPL Token
  const mint = await createMint({ client, payer, authority: mintAuthority, decimals:9 });
  const token = await createToken({ client, payer, mint, owner });

  // When the mint authority mints tokens to the token account.
  const mintTo = getMintToInstruction({
    mint,
    token,
    mintAuthority,
    amount: 100n,
  });
  await sendAndConfirmInstructions(client, payer, [mintTo]);
  // Step 2: Create an associated token account for the owner
  const createAta = await getCreateAssociatedTokenInstructionAsync({
    payer,
    mint,
    owner: owner.address,
  });
  await sendAndConfirmInstructions(client, payer, [createAta]);

  const [ata] = await findAssociatedTokenPda({
    mint,
    owner: owner.address,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });

  // Ensure the token account was initialized properly
  const initialTokenAccount = await fetchToken(client.rpc, ata);
  t.is(initialTokenAccount.data.state, AccountState.Initialized);
  // Step 3: Withdraw excess lamports from `ata` to `destination`
  const lamportsBefore = await client.rpc.getBalance(destination.address);
  const withdrawIx = await getWithdrawExcessLamportsInstruction({
    sourceAccount: ata,
    destinationAccount: destination.address,
    authority: owner.address,
    amount:5n
  });
  await sendAndConfirmInstructions(client, owner, [withdrawIx]);

  // Check balances after withdrawal
  const lamportsAfter = await client.rpc.getBalance(destination.address);
  t.true(lamportsAfter > lamportsBefore, "Lamports successfully withdrawn");
});
