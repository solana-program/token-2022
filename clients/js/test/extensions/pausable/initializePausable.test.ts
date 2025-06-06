import { Account, generateKeyPairSigner, isSome, some } from '@solana/kit';
import test from 'ava';
import {
  getInitializePausableConfigInstruction,
  extension,
  fetchMint,
  Mint,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it initializes a mint with a pausable config', async (t) => {
  // Given a fresh client with no state the test cares about.
  const client = createDefaultSolanaClient();
  const [authority, mint] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

  // And a pausable config extension.
  const pausableConfigExtension = extension('PausableConfig', {
    authority: some(authority.address),
    paused: false,
  });

  // When we initialize the mint with the pausable config extension.
  const [createMintInstruction, initMintInstruction] =
    await getCreateMintInstructions({
      authority: authority.address,
      client,
      decimals: 2,
      extensions: [pausableConfigExtension],
      mint,
      payer: authority,
    });
  await sendAndConfirmInstructions(client, authority, [
    createMintInstruction,
    getInitializePausableConfigInstruction({
      mint: mint.address,
      authority: authority.address,
    }),
    initMintInstruction,
  ]);

  // Then we expect the mint account to exist and have the following data.
  const mintAccount = await fetchMint(client.rpc, mint.address);
  t.like(mintAccount, <Account<Mint>>{
    address: mint.address,
    data: {
      mintAuthority: some(authority.address),
      isInitialized: true,
      extensions: some([pausableConfigExtension]),
    },
  });
});
