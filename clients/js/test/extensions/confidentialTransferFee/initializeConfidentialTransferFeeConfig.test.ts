import { Account, generateKeyPairSigner, PublicKey, some } from '@solana/web3.js';
import test from 'ava';
import {
  getInitializeConfidentialTransferFeeConfigInstruction,
  fetchMint,
  extension,
  Mint,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('initializeConfidentialTransferFeeConfig should initialize transfer fee config for a mint', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, mint] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

  // Create the instruction for initializing Confidential Transfer Fee Config.
  const confidentialTransferFeeConfigInstruction = getInitializeConfidentialTransferFeeConfigInstruction({
    mint: mint.address,
    authority: some(authority.publicKey),
    withdrawWithheldAuthorityElgamalPubkey: new PublicKey('YourElGamalPublicKeyHere'), // Example public key for ElGamal
  });

  // When we send the instructions to the blockchain.
  await sendAndConfirmInstructions(client, authority, [
    confidentialTransferFeeConfigInstruction,
  ]);

  // Then we expect the mint account to exist and have the proper transfer fee config initialized.
  const mintAccount = await fetchMint(client.rpc, mint.address);
  t.true(mintAccount, 'Mint account should exist');
  t.deepEqual(mintAccount.data.extensions, some([confidentialTransferFeeConfigInstruction]), 'Mint should have the proper extension');
});
