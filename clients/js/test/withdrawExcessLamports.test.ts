import test from 'ava';
import { generateKeyPairSigner } from '@solana/web3.js';
import {
  createDefaultSolanaClient,
  sendAndConfirmInstructions,
  generateKeyPairSignerWithSol,
} from './_setup';
import { getWithdrawExcessLamportsInstruction } from '../src';

test('it withdraws excess lamports from program account', async (t) => {
  // Setup Solana client and accounts
  const client = createDefaultSolanaClient();

  // Step 1: Generate the required accounts and fund the program account with excess lamports
  const [programAccount, destinationAccount, authority] = await Promise.all([
    generateKeyPairSignerWithSol(client, 2_000_000_000n), // Fund with 2 SOL (excess)
    generateKeyPairSignerWithSol(client),                 // Empty destination account
    generateKeyPairSigner(),                              // Authority
  ]);

  // Step 2: Check initial balances and log them
  const initialProgramBalance = await client.rpc.getBalance(programAccount.address).send();
  const initialDestinationBalance = await client.rpc.getBalance(destinationAccount.address).send();

  // Step 3: Define the required minimum balance
  const requiredBalance = 1_000_000n; // Assuming 1_000_000 lamports as the minimum required balance

  // Step 4: Prepare the withdraw excess lamports instruction
  const withdrawInstruction = getWithdrawExcessLamportsInstruction({
    programAccount: programAccount.address,
    destinationAccount: destinationAccount.address,
    authority: authority,
  });

  // Step 5: Attempt to send the transaction and catch any errors for better debugging
  try {
    await sendAndConfirmInstructions(client, authority, [withdrawInstruction]);
  } catch (error) {
    console.error("Transaction failed: ", error);
    t.fail("Failed to withdraw excess lamports.");
    return;
  }

  // Step 6: Fetch final balances and validate
  const finalProgramBalance = await client.rpc.getBalance(programAccount.address).send();
  const finalDestinationBalance = await client.rpc.getBalance(destinationAccount.address).send();

  // Ensure program account retains only the required minimum balance
  t.is(Number(finalProgramBalance.value), Number(requiredBalance), "Program account balance mismatch");

  // Calculate expected transfer amount and verify it in the destination balance
  const expectedTransferAmount = initialProgramBalance.value - requiredBalance;
  t.is(
    Number(finalDestinationBalance.value) - Number(initialDestinationBalance.value),
    Number(expectedTransferAmount),
    "Transferred amount does not match expected excess lamports"
  );
});
