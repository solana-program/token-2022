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
import { generateKeyPairSigner } from '@solana/kit';

test('it withdraws excess lamports from an associated token account', async (t) => {
  // Given: A client, a payer, mint authority, token owner, and destination account
  const client = createDefaultSolanaClient();
  const [payer, mintAuthority, owner, destination] = await Promise.all([
    generateKeyPairSignerWithSol(client, 200_000_000n),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);

  // And a mint and token are created
  const mint = await createMint({
    client,
    payer,
    authority: mintAuthority,
    decimals: 9,
  });
  const token = await createToken({ client, payer, mint, owner });

  // And tokens are minted to the token account
  const mintToInstruction = getMintToInstruction({
    mint,
    token,
    mintAuthority,
    amount: 100_000n,
  });
  await sendAndConfirmInstructions(client, payer, [mintToInstruction]);

  // And an associated token account (ATA) is created for the owner
  const createAtaInstruction = await getCreateAssociatedTokenInstructionAsync({
    payer,
    mint,
    owner: owner.address,
  });
  await sendAndConfirmInstructions(client, payer, [createAtaInstruction]);

  const [ata] = await findAssociatedTokenPda({
    mint,
    owner: owner.address,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });

  // Ensure the token account was initialized correctly
  const initialTokenAccount = await fetchToken(client.rpc, ata);
  t.is(initialTokenAccount.data.state, AccountState.Initialized);

  // When: SOL is mistakenly transferred to the ATA
  const transferSolInstruction = await getTransferSolInstruction({
    source: payer,
    destination: ata,
    amount: 1_000_000n,
  });
  await sendAndConfirmInstructions(client, payer, [transferSolInstruction]);

  // Capture initial balances for comparison after withdrawal
  const lamportsBefore = await client.rpc
    .getBalance(destination.address)
    .send();
  const ataLamportsBefore = await client.rpc.getBalance(ata).send();

  // And we initiate withdrawal of excess lamports from the ATA to the destination
  const withdrawInstruction = await getWithdrawExcessLamportsInstruction({
    sourceAccount: ata,
    destinationAccount: destination.address,
    authority: owner,
  });
  await sendAndConfirmInstructions(client, payer, [withdrawInstruction]);

  // Then: Verify that lamports were successfully withdrawn to the destination
  const lamportsAfter = await client.rpc.getBalance(destination.address).send();
  const ataLamportsAfter = await client.rpc.getBalance(ata).send();

  // Assertions to confirm successful transfer of lamports
  t.true(
    Number(lamportsAfter.value) > Number(lamportsBefore.value),
    'Lamports were successfully withdrawn to the destination account.'
  );
  t.true(
    Number(ataLamportsBefore.value) > Number(ataLamportsAfter.value),
    'Lamports were successfully withdrawn from the ATA.'
  );
});
