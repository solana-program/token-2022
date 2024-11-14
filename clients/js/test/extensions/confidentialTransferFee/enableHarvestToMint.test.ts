// import { Account, PublicKey, generateKeyPairSigner } from '@solana/web3.js';
// import test from 'ava';
// import {
//   getEnableHarvestToMintInstruction,
//   fetchMintAccount,
// } from '../../../src';
// import {
//   createDefaultSolanaClient,
//   generateKeyPairSignerWithSol,
//   sendAndConfirmInstructions,
// } from '../../_setup';

// test('enableHarvestToMint should configure mint to accept harvested confidential fees', async (t) => {
//   // Given the mint and authority setup
//   const client = createDefaultSolanaClient();
//   const [authority, mint] = await Promise.all([
//     generateKeyPairSignerWithSol(client),
//     generateKeyPairSigner(),
//   ]);

//   // Create the instruction to enable the mint to accept harvested confidential fees
//   const enableHarvestToMintInstruction = getEnableHarvestToMintInstruction({
//     mint: mint.address,
//     authority: authority.publicKey,
//     confidentialTransferFeeDiscriminator: 4, // Example discriminator
//     discriminator: 37, // Example discriminator
//   });

//   // When we send the instruction to enable harvest to mint
//   await sendAndConfirmInstructions(client, authority, [
//     enableHarvestToMintInstruction,
//   ]);

//   // Then we expect the mint account to be configured to accept harvested confidential fees
//   const mintAccount = await fetchMintAccount(client.rpc, mint.address);

//   // Check if the mint account is properly configured to accept fees
//   t.true(mintAccount.data.acceptsHarvestedFees, 'Mint account should accept harvested fees');
// });

// test('enableHarvestToMint should fail if authority is not signer', async (t) => {
//   // Given the mint setup without correct authority signer
//   const client = createDefaultSolanaClient();
//   const [wrongAuthority, mint] = await Promise.all([
//     generateKeyPairSignerWithSol(client),
//     generateKeyPairSigner(),
//   ]);

//   // Create the instruction to enable the mint to accept harvested confidential fees
//   const enableHarvestToMintInstruction = getEnableHarvestToMintInstruction({
//     mint: mint.address,
//     authority: wrongAuthority.publicKey, // Wrong authority (not signer)
//     confidentialTransferFeeDiscriminator: 4,
//     discriminator: 37,
//   });

//   // Expect the transaction to fail due to wrong signer
//   await t.throwsAsync(
//     () => sendAndConfirmInstructions(client, wrongAuthority, [enableHarvestToMintInstruction]),
//     { message: /Signer missing/ },
//   );
// });

// test('enableHarvestToMint should handle multisig authority correctly', async (t) => {
//   // Given the mint and multisig authority setup
//   const client = createDefaultSolanaClient();
//   const [multisigAuthority, mint, multisigSigner1, multisigSigner2] = await Promise.all([
//     generateKeyPairSignerWithSol(client),
//     generateKeyPairSigner(),
//     generateKeyPairSigner(),
//     generateKeyPairSigner(),
//   ]);

//   // Create the instruction with multisig authorities
//   const enableHarvestToMintInstruction = getEnableHarvestToMintInstruction({
//     mint: mint.address,
//     authority: multisigAuthority.publicKey, // Multisig authority
//     multisig_signers: [multisigSigner1.publicKey, multisigSigner2.publicKey],
//     confidentialTransferFeeDiscriminator: 4,
//     discriminator: 37,
//   });

//   // When we send the instruction with multisig authorities
//   await sendAndConfirmInstructions(client, multisigAuthority, [
//     enableHarvestToMintInstruction,
//   ]);

//   // Then we expect the mint account to be configured correctly with multisig authority
//   const mintAccount = await fetchMintAccount(client.rpc, mint.address);
//   t.true(mintAccount.data.acceptsHarvestedFees, 'Mint account should accept harvested fees with multisig authority');
// });
