import test from 'ava';
import {
  AccountState,
  TOKEN_2022_PROGRAM_ADDRESS,
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
import { getTransferSolInstruction } from '@solana-program/system';

test('withdraw excess lamports from an associated token account', async (t) => {
  // Arrange: Setup client, accounts, mint, token, and fund accounts
  const client = createDefaultSolanaClient();
  const [payer, mintAuthority, owner, destination] = await Promise.all([
    generateKeyPairSignerWithSol(client, 200_000_000n),
    generateKeyPairSignerWithSol(client),
    generateKeyPairSignerWithSol(client),
    generateKeyPairSignerWithSol(client),
  ]);

  // Create an SPL Token
  const mint = await createMint({
    client,
    payer,
    authority: mintAuthority,
    decimals: 9,
  });
  const token = await createToken({ client, payer, mint, owner });

  // Mint tokens to the token account
  const mintTo = getMintToInstruction({
    mint,
    token,
    mintAuthority,
    amount: 100_000n,
  });
  await sendAndConfirmInstructions(client, payer, [mintTo]);

  // Create an associated token account (ATA) for the owner
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

  // Act: Transfer SOL to the ATA mistakenly and then withdraw excess lamports
  // Step 1: Mistaken SOL transfer to ATA
  const transferSolIx = await getTransferSolInstruction({
    source: payer,
    destination: ata,
    amount: 1_000_000n,
  });
  await sendAndConfirmInstructions(client, payer, [transferSolIx]);

  // Check initial balances before withdrawal
  const lamportsBefore = await client.rpc
    .getBalance(destination.address)
    .send();
  const ataLamportsBefore = await client.rpc.getBalance(ata).send();

  // Step 2: Withdraw excess lamports from ATA to destination
  const withdrawIx = await getWithdrawExcessLamportsInstruction({
    sourceAccount: ata,
    destinationAccount: destination.address,
    authority: owner,
  });
  await sendAndConfirmInstructions(client, owner, [withdrawIx]);

  // Assert: Check that lamports were successfully withdrawn from ATA to destination
  const lamportsAfter = await client.rpc.getBalance(destination.address).send();
  const ataLamportsAfter = await client.rpc.getBalance(ata).send();

  // Assertions for balance changes
  t.true(
    Number(lamportsAfter.value) > Number(lamportsBefore.value),
    'Lamports successfully withdrawn to destination.'
  );
  t.true(
    Number(ataLamportsBefore.value) > Number(ataLamportsAfter.value),
    'Lamports successfully withdrawn from ATA.'
  );
});
