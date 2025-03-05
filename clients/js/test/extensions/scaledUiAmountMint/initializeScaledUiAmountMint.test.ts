import test from 'ava';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';
import { Account, address, generateKeyPairSigner, isSome } from '@solana/web3.js';
import {
  extension,
  fetchMint,
  getInitializeScaledUiAmountMintInstruction,
  Mint,
} from '../../../src';

test('it initialize a mint account with an interest bearing mint extension', async (t) => {
  const client = createDefaultSolanaClient();
  const [authority, mint] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

  const newMultiplier = 2;

  // And a scaled ui amount mint extension.
  const scaledUiAmountMintExtension = extension('ScaledUiAmountConfig', {
    authority: authority.address,
    multiplier: 1,
    newMultiplierEffectiveTimestamp: BigInt(Math.floor(new Date().getTime() / 1000)),
    newMultiplier,
  });

  // When we initialize the mint account with the scaled ui amount mint extension.

  // And a mint close authority extension.
  const [createMintInstruction, initMintInstruction] =
    await getCreateMintInstructions({
      authority: authority.address,
      client,
      decimals: 2,
      extensions: [scaledUiAmountMintExtension],
      mint,
      payer: authority,
    });
  await sendAndConfirmInstructions(client, authority, [
    createMintInstruction,
    getInitializeScaledUiAmountMintInstruction({
      mint: mint.address,
      authority: authority.address,
      multiplier: 1,
    }),
    initMintInstruction,
  ]);

  const mintAccount = await fetchMint(client.rpc, mint.address);

  const extensions = mintAccount.data.extensions;

  t.true(isSome(extensions));
  t.true(
    isSome(extensions) && extensions.value[0].__kind === 'ScaledUiAmountConfig'
  );

  // check without need to check timestamp specifically
  if (
    isSome(extensions) &&
    extensions.value[0].__kind === 'ScaledUiAmountConfig'
  ) {
    t.is(extensions.value[0].authority, authority.address);
    t.is(extensions.value[0].multiplier, 1);
    t.true(typeof extensions.value[0].newMultiplierEffectiveTimestamp === 'bigint');
    t.is(extensions.value[0].newMultiplier, 1);
  }

  t.like(mintAccount, <Account<Mint>>{
    address: mint.address,
  });
});