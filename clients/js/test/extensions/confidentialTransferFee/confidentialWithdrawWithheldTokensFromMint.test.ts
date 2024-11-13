import { Account, PublicKey, generateKeyPairSigner, some } from '@solana/web3.js';
import test from 'ava';
import {
  getConfidentialWithdrawWithheldTokensFromMintInstruction,
  fetchMint,
  fetchTokenAccount,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('withdrawWithheldTokensFromMint should transfer withheld tokens to destination account', async (t) => {
  // Given some signer accounts and mint setup.
  const client = createDefaultSolanaClient();
  const [authority, mint, destinationAccount, proofAccount] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);

  // Set up the instruction to withdraw withheld tokens.
  const proofInstructionOffset = 0; // Example offset, adjust based on actual proof
  const newDecryptableAvailableBalance = destinationAccount.publicKey; // Destination account

  const withdrawWithheldTokensInstruction = getConfidentialWithdrawWithheldTokensFromMintInstruction({
    mint: mint.address,
    destination: destinationAccount.publicKey,
    instructionsSysvar: null, // Set sysvar if needed
    recordAccount: null, // Optional, if proof is read from a record account
    withdrawWithheldAuthority: authority.publicKey,
    proofInstructionOffset,
    newDecryptableAvailableBalance,
    confidentialTransferFeeDiscriminator: 1, // Example discriminator
    discriminator: 37, // Example discriminator
  });

  // When we send the instruction to withdraw withheld tokens.
  await sendAndConfirmInstructions(client, authority, [
    withdrawWithheldTokensInstruction,
  ]);

  // Then we expect the mint account to exist and have the correct state.
  const mintAccount = await fetchMint(client.rpc, mint.address);
  const destinationTokenAccount = await fetchTokenAccount(client.rpc, destinationAccount.publicKey);

  // Ensure the withheld tokens are transferred to the destination account
  t.true(destinationTokenAccount.data.amount > 0, 'Destination account should have received withheld tokens');

  // Additional validation could check whether the mint account data or other states are updated.
  t.deepEqual(mintAccount.data.extensions, some([]), 'Mint should not have any withheld tokens remaining');
});

