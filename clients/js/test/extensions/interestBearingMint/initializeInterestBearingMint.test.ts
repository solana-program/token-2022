import { generateKeyPairSigner, some } from '@solana/web3.js';
import test from 'ava';
import {
  extension,
  fetchMint,
  getInitializeInterestBearingMintInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it initializes a mint with interest bearing configuration', async (t) => {
  // Given some signer accounts
  const client = createDefaultSolanaClient();
  const [authority, mint] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

  // And an interest bearing extension
  const interestBearingExtension = extension('InterestBearingConfig', {
    rateAuthority: authority.address,
    initializationTimestamp: 0n,
    preUpdateAverageRate: 500,
    lastUpdateTimestamp: 0n,
    currentRate: 500,
  });

  // When we create and initialize a mint account with this extension
  const [createMintInstruction, initMintInstruction] =
    await getCreateMintInstructions({
      authority: authority.address,
      client,
      extensions: [interestBearingExtension],
      mint,
      payer: authority,
    });

  await sendAndConfirmInstructions(client, authority, [
    createMintInstruction,
    getInitializeInterestBearingMintInstruction({
      mint: mint.address,
      rateAuthority: some(authority.address),
      rate: 500,
    }),
    initMintInstruction,
  ]);

  // Then we expect the mint account to exist with interest bearing configuration
  const mintAccount = await fetchMint(client.rpc, mint.address);

  // Verify account basics
  t.deepEqual(mintAccount.address, mint.address);
  t.deepEqual(mintAccount.data.mintAuthority, some(authority.address));
  t.true(mintAccount.data.isInitialized);

  // Get extension from the option value
  const extensions =
    mintAccount.data.extensions.__option === 'Some'
      ? mintAccount.data.extensions.value
      : [];

  // Verify extension exists
  t.is(extensions.length, 1);
  const extensionData = extensions[0];
  t.is(extensionData.__kind, 'InterestBearingConfig');
  t.deepEqual(extensionData.rateAuthority, authority.address);
  t.is(extensionData.currentRate, 500);
  t.is(extensionData.preUpdateAverageRate, 500);

  // Verify timestamps exist but don't check specific values
  t.true(typeof extensionData.initializationTimestamp === 'bigint');
  t.true(typeof extensionData.lastUpdateTimestamp === 'bigint');
});
