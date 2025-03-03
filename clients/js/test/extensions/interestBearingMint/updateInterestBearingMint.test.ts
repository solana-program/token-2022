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

  // initialize mint with interest bearing mint extension
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

  // then we update the interest bearing mint extension on the mint account
  await sendAndConfirmInstructions(client, rateAuthority, [
    getUpdateRateInterestBearingMintInstruction({
      rateAuthority: rateAuthority,
      mint: mint,
      rate: newRate,
    }),
  ]);

  const mintAccount = await fetchMint(client.rpc, mint);

  // check without need to check timestamp specifically
  const extensions = mintAccount.data.extensions;

  t.true(isSome(extensions));
  t.true(
    isSome(extensions) && extensions.value[0].__kind === 'InterestBearingConfig'
  );

  if (
    isSome(extensions) &&
    extensions.value[0].__kind === 'InterestBearingConfig'
  ) {
    t.is(extensions.value[0].rateAuthority, rateAuthority.address);
    t.true(typeof extensions.value[0].initializationTimestamp === 'bigint');
    t.true(typeof extensions.value[0].lastUpdateTimestamp === 'bigint');
    t.is(extensions.value[0].preUpdateAverageRate, oldRate);
    t.is(extensions.value[0].currentRate, newRate);
  }

  t.like(mintAccount, <Account<Mint>>{
    address: mint,
  });
});
