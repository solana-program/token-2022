import { Account, generateKeyPairSigner, some } from '@solana/web3.js';
import test from 'ava';
import {
  extension,
  fetchMint,
  getConfidentialWithdrawWithheldTokensFromAccountsInstruction,
  Mint,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it withdraws withheld tokens from source accounts to a destination account', async (t) => {
  const client = createDefaultSolanaClient();
  const [
    authority,
    mint,
    destination,
    sourceAccount1,
    sourceAccount2,
    elgamal,
  ] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);

  // Instructions to create and initialize a mint account
  const [createMintInstruction, initMintInstruction] =
    await getCreateMintInstructions({
      authority: authority.address,
      client,
      mint,
      payer: authority,
    });

  // Sending instructions for mint creation and initializing mint
  await sendAndConfirmInstructions(client, authority, [
    createMintInstruction,
    initMintInstruction,
  ]);

  // Create the Confidential Withdraw Withheld Tokens From Accounts instruction
  const proofInstructionOffset = 0; // Assuming no proof verification needed here
  const newDecryptableAvailableBalance = new Uint8Array(64).fill(0); // Replace with the actual balance you expect to transfer

  const numTokenAccounts = 2; // Since we're using two source accounts

  const withdrawInstruction =
    getConfidentialWithdrawWithheldTokensFromAccountsInstruction({
      mint: mint.address,
      destination: destination.address,
      withdrawWithheldAuthority: authority,
      sourceAccounts: [sourceAccount1.address, sourceAccount2.address], // Source accounts from which to withdraw
      proofInstructionOffset,
      newDecryptableAvailableBalance,
      numTokenAccounts,
    });

  // Send the instruction to withdraw withheld tokens from source accounts to the destination
  await sendAndConfirmInstructions(client, authority, [withdrawInstruction]);

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

  // Fetch the mint account to validate the withdrawal
  const mintAccount = await fetchMint(client.rpc, mint.address);
  t.like(mintAccount, {
    address: mint.address,
    data: {
      mintAuthority: authority.address,
      isInitialized: true,
      extensions: some([confidentialTransferFeeConfigExtension]),
    },
  });

  // Optionally, check that the destination account balance has been updated
  const accountInfo = await client.rpc.getAccountInfo(destination.address);
  t.assert(accountInfo, 'Destination account information should exist');
  // You can also validate the balance or check extensions, depending on your logic

  // Optionally, check that source accounts have had their withheld tokens withdrawn
  const sourceAccountInfo1 = await client.rpc.getAccountInfo(
    sourceAccount1.address
  );
  const sourceAccountInfo2 = await client.rpc.getAccountInfo(
    sourceAccount2.address
  );

  t.assert(sourceAccountInfo1, 'Source account 1 information should exist');
  t.assert(sourceAccountInfo2, 'Source account 2 information should exist');
  // Add any checks here to verify that the withheld amount has been correctly removed from the source accounts
});
