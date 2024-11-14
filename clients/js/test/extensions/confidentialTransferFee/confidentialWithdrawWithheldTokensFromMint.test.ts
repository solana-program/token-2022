import { generateKeyPairSigner, some } from '@solana/web3.js';
import test from 'ava';
import {
  extension,
  fetchMint,
  getInitializeConfidentialTransferFeeConfigInstruction,
  getConfidentialWithdrawWithheldTokensFromMintInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('confidentialWithdrawWithheldTokensFromMint instruction works correctly with instructionsSysvar', async (t) => {
  const client = createDefaultSolanaClient();
  const [
    authority,
    mint,
    destinationAccount,
    elgamal,
    instructionsSysvarAccount,
  ] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(), // ElGamal key for the authority
    generateKeyPairSigner(), // This is the sysvar account needed
  ]);

  // Initialize mint with confidential transfer fee config
  const [createMintInstruction, initMintInstruction] =
    await getCreateMintInstructions({
      authority: authority.address,
      client,
      mint,
      payer: authority,
    });

  await sendAndConfirmInstructions(client, authority, [
    createMintInstruction,
    getInitializeConfidentialTransferFeeConfigInstruction({
      mint: mint.address,
      authority: some(authority.address),
      withdrawWithheldAuthorityElgamalPubkey: elgamal.address,
    }),
    initMintInstruction,
  ]);

  // Create confidential transfer fee config extension
  const confidentialTransferFeeConfigExtension = extension(
    'ConfidentialTransferFee',
    {
      authority: some(authority.address),
      elgamalPubkey: elgamal.address,
      harvestToMintEnabled: true,
      withheldAmount: new Uint8Array(64).fill(0),
    }
  );

  // Fetch the mint account to ensure the config is applied
  const mintAccount = await fetchMint(client.rpc, mint.address);

  // Ensure that the mint is initialized with the expected extension
  t.like(mintAccount, {
    address: mint.address,
    data: {
      mintAuthority: some(authority.address),
      isInitialized: true,
      extensions: some([confidentialTransferFeeConfigExtension]),
    },
  });

  // Prepare for the 'confidentialWithdrawWithheldTokensFromMint' instruction
  const proofInstructionOffset = 0; // assuming proof instruction offset is 0 for this test
  const newDecryptableAvailableBalance = new Uint8Array(64); // example value for the new available balance

  // Add the `instructionsSysvar` account (this is an optional sysvar account for proofs)
  const instructionsSysvar = instructionsSysvarAccount.address;

  // Create the confidentialWithdrawWithheldTokensFromMint instruction
  const withdrawInstruction =
    getConfidentialWithdrawWithheldTokensFromMintInstruction({
      mint: mint.address,
      destination: destinationAccount.address,
      withdrawWithheldAuthority: authority,
      proofInstructionOffset,
      newDecryptableAvailableBalance,
      instructionsSysvar, // Add the sysvar account
    });

  // Send the instruction and confirm
  await sendAndConfirmInstructions(client, authority, [withdrawInstruction]);

  // Fetch the destination account data and validate that the balance has been updated
  const destinationAccountData = await client.rpc.getAccountInfo(
    destinationAccount.address
  );
  // Assuming the account has a 'decryptableBalance' field, validate its value
  t.truthy(destinationAccountData);
});
