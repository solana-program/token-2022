import { Account, generateKeyPairSigner } from '@solana/web3.js';
import test from 'ava';
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  getWithdrawExcessLamportsInstruction,
} from '../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from './_setup';
import { getCreateAccountInstruction } from '@solana-program/system';

test('it withdraws excess lamports from a source account to a destination account', async (t) => {
  const client = createDefaultSolanaClient();
  const [sourceAccount, destinationAccount] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

  // Create and fund the destination account
  await sendAndConfirmInstructions(client, sourceAccount, [
    getCreateAccountInstruction({
      payer: sourceAccount,
      newAccount: destinationAccount,
      lamports: BigInt(1_000_000),
      space: 0,
      programAddress: TOKEN_2022_PROGRAM_ADDRESS,
    }),
    getWithdrawExcessLamportsInstruction({
      sourceAccount: sourceAccount.address,
      destinationAccount: destinationAccount.address,
      amount: BigInt(500_000),
    }),
  ]);

  // Verify withdrawal by checking the balances
  const sourceBalance = await client.rpc.getBalance(sourceAccount.address).send();
  const destinationBalance = await client.rpc.getBalance(destinationAccount.address).send();

  t.true(sourceBalance < 1_000_000);
  t.true(destinationBalance >= 1_500_000);
});
