import test from 'ava';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';
import { Account, generateKeyPairSigner, isSome } from '@solana/kit';
import {
  extension,
  fetchMint,
  getInitializeScaledUiAmountMintInstruction,
  Mint,
} from '../../../src';

test('it initialize a mint account with a scaled ui amount mint extension', async (t) => {
  // Given a fresh client with no state the test cares about.
  const client = createDefaultSolanaClient();
  const [authority, mint] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

  const multiplier = 1;
  const newMultiplier = 2;

  // And a scaled ui amount mint extension.
  const scaledUiAmountMintExtension = extension('ScaledUiAmountConfig', {
    authority: authority.address,
    multiplier,
    newMultiplierEffectiveTimestamp: BigInt(
      Math.floor(new Date().getTime() / 1000)
    ),
    newMultiplier,
  });

  // When we initialize the mint account with the scaled ui amount mint extension.
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
      multiplier,
    }),
    initMintInstruction,
  ]);

  const mintAccount = await fetchMint(client.rpc, mint.address);
  // Then the mint account exists.
  t.like(mintAccount, <Account<Mint>>{
    address: mint.address,
  });

  const extensions = mintAccount.data.extensions;

  // And the mint account has a scaled ui amount mint extension.
  t.true(isSome(extensions));
  t.true(
    isSome(extensions) && extensions.value[0].__kind === 'ScaledUiAmountConfig'
  );

  if (
    isSome(extensions) &&
    extensions.value[0].__kind === 'ScaledUiAmountConfig'
  ) {
    // And the extension has the correct authority.
    t.is(extensions.value[0].authority, authority.address);
    // And the extension has the correct multiplier.
    t.is(extensions.value[0].multiplier, multiplier);
    // And the extension has the correct new multiplier effective timestamp.
    t.true(
      typeof extensions.value[0].newMultiplierEffectiveTimestamp === 'bigint'
    );
    // And the extension has the correct new multiplier which is not changed due to how the extension is initialized.
    t.is(extensions.value[0].newMultiplier, multiplier);
  }
});
