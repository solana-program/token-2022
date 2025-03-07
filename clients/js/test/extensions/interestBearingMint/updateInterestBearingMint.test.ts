import test from 'ava';
import {
  createDefaultSolanaClient,
  createMint,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from '../../_setup';
import { Account, isSome } from '@solana/kit';
import {
  extension,
  fetchMint,
  getUpdateRateInterestBearingMintInstruction,
  Mint,
} from '../../../src';

test('it updates the interest bearing mint extension on a mint account', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [rateAuthority] = await Promise.all([
    generateKeyPairSignerWithSol(client),
  ]);

  const oldRate = 10000;
  const newRate = 20000;

  // And a mint with an interest bearing mint extension.
  const mint = await createMint({
    authority: rateAuthority,
    client,
    extensions: [
      extension('InterestBearingConfig', {
        rateAuthority: rateAuthority.address,
        initializationTimestamp: BigInt(
          Math.floor(new Date().getTime() / 1000)
        ),
        lastUpdateTimestamp: BigInt(Math.floor(new Date().getTime() / 1000)),
        preUpdateAverageRate: oldRate,
        currentRate: oldRate,
      }),
    ],
    payer: rateAuthority,
  });

  // When we update the interest bearing mint extension on the mint account
  await sendAndConfirmInstructions(client, rateAuthority, [
    getUpdateRateInterestBearingMintInstruction({
      rateAuthority: rateAuthority,
      mint: mint,
      rate: newRate,
    }),
  ]);

  const mintAccount = await fetchMint(client.rpc, mint);
  t.like(mintAccount, <Account<Mint>>{
    address: mint,
  });

  // Then the mint account has an interest bearing mint extension.
  const extensions = mintAccount.data.extensions;
  t.true(isSome(extensions));
  t.true(
    isSome(extensions) && extensions.value[0].__kind === 'InterestBearingConfig'
  );

  if (
    isSome(extensions) &&
    extensions.value[0].__kind === 'InterestBearingConfig'
  ) {
    // And the extension has the correct rate authority.
    t.is(extensions.value[0].rateAuthority, rateAuthority.address);
    // And the extension has the correct initialization timestamp.
    t.true(typeof extensions.value[0].initializationTimestamp === 'bigint');
    // And the extension has the correct last update timestamp.
    t.true(typeof extensions.value[0].lastUpdateTimestamp === 'bigint');
    // And the extension has the correct pre update average rate.
    t.is(extensions.value[0].preUpdateAverageRate, oldRate);
    // And the extension has the correct new current rate.
    t.is(extensions.value[0].currentRate, newRate);
  }
});
