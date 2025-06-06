import { generateKeyPairSigner, isSome, some } from '@solana/kit';
import test from 'ava';
import {
  getInitializePausableConfigInstruction,
  extension,
  fetchMint,
  getPauseInstruction,
  getResumeInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it resumes a mint', async (t) => {
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

  // And when pause the mint.
  const pauseInstruction = getPauseInstruction({
    mint: mint.address,
    authority: authority.address,
  });
  await sendAndConfirmInstructions(client, authority, [pauseInstruction]);

  // And when resume the mint.
  const resumeInstruction = getResumeInstruction({
    mint: mint.address,
    authority: authority.address,
  });
  await sendAndConfirmInstructions(client, authority, [resumeInstruction]);

  // Then we expect the mint account to exist and have the pausable config extension.
  const mintAccount = await fetchMint(client.rpc, mint.address);
  const extensions = mintAccount.data.extensions;
  t.true(isSome(extensions));
  t.true(isSome(extensions) && extensions.value[0].__kind === 'PausableConfig');

  if (isSome(extensions) && extensions.value[0].__kind === 'PausableConfig') {
    // And the extension has the correct resumed state.
    t.is(extensions.value[0].paused, false);
  }
});
