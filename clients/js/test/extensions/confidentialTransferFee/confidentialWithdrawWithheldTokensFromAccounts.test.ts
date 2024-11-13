import { Account, PublicKey, generateKeyPairSigner, some } from '@solana/web3.js';
import test from 'ava';
import {
  getConfidentialWithdrawWithheldTokensFromAccountsInstruction,
  fetchTokenAccount,
  fetchMint,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from '../../_setup';

test('withdrawWithheldTokensFromAccounts should transfer withheld tokens to destination account', async (t) => {
  // Given some signer accounts and mint setup.
  const client = createDefaultSolanaClient();
  const [authority, mint, destinationAccount, sourceAccount, proofAccount] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);

  // Set up the instruction to withdraw withheld tokens from multiple accounts.
  const numTokenAccounts = 1; // Example: with a single source account
  const proofInstructionOffset = 0; // Offset for the proof verification
  const newDecryptableAvailableBalance = destinationAccount.publicKey; // Destination account to receive the withheld tokens

  // Prepare the instruction for withdrawing withheld tokens from source accounts.
  const withdrawWithheldTokensInstruction = getConfidentialWithdrawWithheldTokensFromAccountsInstruction({
    mint: mint.address,
    destination: destinationAccount.publicKey,
    instructionsSysvar: null, // Set sysvar if needed
    recordAccount: null, // Optional record account if the accompanying proof is to be read
    withdrawWithheldAuthority: authority.publicKey,
    sourceAccounts: [sourceAccount.publicKey],
    numTokenAccounts,
    proofInstructionOffset,
    newDecryptableAvailableBalance,
    confidentialTransferFeeDiscriminator: 2, // Example discriminator
    discriminator: 37, // Example discriminator
  });

  // When we send the instruction to withdraw withheld tokens.
  await sendAndConfirmInstructions(client, authority, [
    withdrawWithheldTokensInstruction,
  ]);

  // Then we expect the destination account to have the new decryptable balance.
  const destinationTokenAccount = await fetchTokenAccount(client.rpc, destinationAccount.publicKey);

  // Check if the destination account has received tokens.
  t.true(destinationTokenAccount.data.amount > 0, 'Destination account should have received withheld tokens');

  // Ensure the source account no longer has withheld tokens.
  const sourceTokenAccount = await fetchTokenAccount(client.rpc, sourceAccount.publicKey);
  t.is(sourceTokenAccount.data.amount, 0, 'Source account should not have withheld tokens left');

  // Additional checks to validate the mint or other accounts could be added here
  const mintAccount = await fetchMint(client.rpc, mint.address);
  t.deepEqual(mintAccount.data.extensions, some([]), 'Mint should not have any withheld tokens remaining');
});
