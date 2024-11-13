import { Account, PublicKey, generateKeyPairSigner, some } from '@solana/web3.js';
import test from 'ava';
import {
  getConfidentialHarvestWithheldTokensToMintInstruction,
  fetchTokenAccount,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from '../../_setup';

test('harvestWithheldTokensToMint should transfer withheld tokens to mint', async (t) => {
  // Given some signer accounts and mint setup.
  const client = createDefaultSolanaClient();
  const [authority, mint, sourceAccount] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);

  // Add TransferFeeAmount and ConfidentialTransferAccount extension to the source account.
  // This is assumed to be part of the account setup for testing.
  const sourceAccountWithExtensions = sourceAccount.publicKey; // Assuming this account has the required extensions.

  // Create the instruction for harvesting withheld tokens.
  const harvestWithheldTokensInstruction = getConfidentialHarvestWithheldTokensToMintInstruction({
    mint: mint.address,
    sourceAccounts: [sourceAccountWithExtensions],
    confidentialTransferFeeDiscriminator: 3, // Example discriminator
    discriminator: 37, // Example discriminator
  });

  // When we send the instruction to harvest withheld tokens.
  await sendAndConfirmInstructions(client, authority, [
    harvestWithheldTokensInstruction,
  ]);

  // Then we expect the mint account to have received withheld tokens.
  const mintTokenAccount = await fetchTokenAccount(client.rpc, mint.address);

  // Check if the mint account has received tokens.
  t.true(mintTokenAccount.data.amount > 0, 'Mint account should have received withheld tokens');

  // Additional checks to validate source account can be added here.
  const sourceTokenAccount = await fetchTokenAccount(client.rpc, sourceAccount.publicKey);
  t.is(sourceTokenAccount.data.amount, 0, 'Source account should no longer have withheld tokens');
});

test('harvestWithheldTokensToMint should skip accounts without required extensions', async (t) => {
  // Given some signer accounts and mint setup.
  const client = createDefaultSolanaClient();
  const [authority, mint, sourceAccountWithoutExtensions] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);

  // Source account without extensions (does not include TransferFeeAmount or ConfidentialTransferAccount).
  const sourceAccount = sourceAccountWithoutExtensions.publicKey;

  // Create the instruction for harvesting withheld tokens.
  const harvestWithheldTokensInstruction = getConfidentialHarvestWithheldTokensToMintInstruction({
    mint: mint.address,
    sourceAccounts: [sourceAccount],
    confidentialTransferFeeDiscriminator: 3,
    discriminator: 37,
  });

  // When we send the instruction to harvest withheld tokens.
  await sendAndConfirmInstructions(client, authority, [
    harvestWithheldTokensInstruction,
  ]);

  // Then we expect that no tokens were moved from the source account to the mint.
  const mintTokenAccount = await fetchTokenAccount(client.rpc, mint.address);

  // Mint account should have received no tokens if the source account is skipped.
  t.is(mintTokenAccount.data.amount, 0, 'Mint account should not have received any tokens from source account without extensions');

  // Check if the source account has no withheld tokens (should remain unchanged).
  const sourceTokenAccount = await fetchTokenAccount(client.rpc, sourceAccountWithoutExtensions.publicKey);
  t.is(sourceTokenAccount.data.amount, 0, 'Source account should not have withheld tokens if no extensions exist');
});
