import { some } from '@solana/web3.js';
import test from 'ava';
import {
  Extension,
  extension,
  fetchMint,
  getUpdateInterestBearingRateInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  createMint,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it updates interest rate on a mint', async (t) => {
  // Given a mint with interest bearing configuration
  const client = createDefaultSolanaClient();
  const authority = await generateKeyPairSignerWithSol(client);

  // Initialize mint with interest bearing extension
  const interestBearingExtension = extension('InterestBearingConfig', {
    rateAuthority: authority.address,
    initializationTimestamp: 0n,
    preUpdateAverageRate: 500,
    lastUpdateTimestamp: 0n,
    currentRate: 500,
  });

  const mint = await createMint({
    authority,
    client,
    extensions: [interestBearingExtension],
    payer: authority,
  });

  // When we update the interest rate
  await sendAndConfirmInstructions(client, authority, [
    getUpdateInterestBearingRateInstruction({
      mint: mint,
      rateAuthority: authority,
      rate: 1000, // New rate of 10%
    }),
  ]);

  // Then we expect the mint account to have the updated rate
  const mintAccount = await fetchMint(client.rpc, mint);

  // Verify base account state
  t.deepEqual(mintAccount.address, mint);
  t.deepEqual(mintAccount.data.mintAuthority, some(authority.address));
  t.true(mintAccount.data.isInitialized);

  // Get typed extension
  const extensions =
    mintAccount.data.extensions.__option === 'Some'
      ? (mintAccount.data.extensions.value as Extension[])
      : [];

  t.is(extensions.length, 1);
  const extensionData = extensions[0];
  t.is(extensionData.__kind, 'InterestBearingConfig');

  // Verify updated rate configuration
  if (extensionData.__kind === 'InterestBearingConfig') {
    t.deepEqual(extensionData.rateAuthority, authority.address);
    t.is(extensionData.currentRate, 1000);
  }
});
