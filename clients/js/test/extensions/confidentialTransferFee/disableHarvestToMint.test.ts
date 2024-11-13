import { Account, PublicKey, generateKeyPairSigner } from '@solana/web3.js';
import test from 'ava';
import {
  getDisableHarvestToMintInstruction,
  fetchMintAccount,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from '../../_setup';

test('disableHarvestToMint should configure mint to reject harvested confidential fees', async (t) => {
  // Given the mint and authority setup
  const client = createDefaultSolanaClient();
  const [authority, mint] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

  // Create the instruction to disable the mint from accepting harvested confidential fees
  const disableHarvestToMintInstruction = getDisableHarvestToMintInstruction({
    mint: mint.address,
    authority: authority.publicKey,
    confidentialTransferFeeDiscriminator: 5, // Example discriminator
    discriminator: 37, // Example discriminator
  });

  // When we send the instruction to disable harvest to mint
  await sendAndConfirmInstructions(client, authority, [
    disableHarvestToMintInstruction,
  ]);

  // Then we expect the mint account to be configured to reject harvested confidential fees
  const mintAccount = await fetchMintAccount(client.rpc, mint.address);

  // Check if the mint account is properly configured to reject harvested fees
  t.false(mintAccount.data.acceptsHarvestedFees, 'Mint account should reject harvested fees');
});

test('disableHarvestToMint should fail if authority is not signer', async (t) => {
  // Given the mint setup without correct authority signer
  const client = createDefaultSolanaClient();
  const [wrongAuthority, mint] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

  // Create the instruction to disable the mint from accepting harvested confidential fees
  const disableHarvestToMintInstruction = getDisableHarvestToMintInstruction({
    mint: mint.address,
    authority: wrongAuthority.publicKey, // Wrong authority (not signer)
    confidentialTransferFeeDiscriminator: 5,
    discriminator: 37,
  });

  // Expect the transaction to fail due to wrong signer
  await t.throwsAsync(
    () => sendAndConfirmInstructions(client, wrongAuthority, [disableHarvestToMintInstruction]),
    { message: /Signer missing/ },
  );
});

test('disableHarvestToMint should handle multisig authority correctly', async (t) => {
  // Given the mint and multisig authority setup
  const client = createDefaultSolanaClient();
  const [multisigAuthority, mint, multisigSigner1, multisigSigner2] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);

  // Create the instruction with multisig authorities
  const disableHarvestToMintInstruction = getDisableHarvestToMintInstruction({
    mint: mint.address,
    authority: multisigAuthority.publicKey, // Multisig authority
    multisig_signers: [multisigSigner1.publicKey, multisigSigner2.publicKey],
    confidentialTransferFeeDiscriminator: 5,
    discriminator: 37,
  });

  // When we send the instruction with multisig authorities
  await sendAndConfirmInstructions(client, multisigAuthority, [
    disableHarvestToMintInstruction,
  ]);

  // Then we expect the mint account to be configured correctly with multisig authority
  const mintAccount = await fetchMintAccount(client.rpc, mint.address);
  t.false(mintAccount.data.acceptsHarvestedFees, 'Mint account should reject harvested fees with multisig authority');
});
