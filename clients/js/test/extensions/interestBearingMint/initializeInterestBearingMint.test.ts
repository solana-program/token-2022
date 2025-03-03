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
  getInitializeInterestBearingMintInstruction,
  Mint,
} from '../../../src';

test('it initialize a mint account with an interest bearing mint extension', async (t) => {
  const client = createDefaultSolanaClient();
  const [rateAuthority, mint] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

  // in bips
  const rate = 10000;

  // And a interest bearing pointer extension.
  const interestBearingMintExtension = extension('InterestBearingConfig', {
    rateAuthority: rateAuthority.address,
    initializationTimestamp: BigInt(Math.floor(new Date().getTime() / 1000)),
    lastUpdateTimestamp: BigInt(Math.floor(new Date().getTime() / 1000)),
    preUpdateAverageRate: 10000,
    currentRate: rate,
  });

  // When we initialize the mint account with the interest bearing mint extension.
  const [createMintInstruction, initMintInstruction] =
    await getCreateMintInstructions({
      authority: rateAuthority.address,
      client,
      extensions: [interestBearingMintExtension],
      mint,
      payer: rateAuthority,
    });
  await sendAndConfirmInstructions(client, rateAuthority, [
    createMintInstruction,
    getInitializeInterestBearingMintInstruction({
      rateAuthority: rateAuthority.address,
      mint: mint.address,
      rate: rate,
    }),
    initMintInstruction,
  ]);

  const mintAccount = await fetchMint(client.rpc, mint.address);

  const extensions = mintAccount.data.extensions;

  t.true(isSome(extensions));
  t.true(
    isSome(extensions) && extensions.value[0].__kind === 'InterestBearingConfig'
  );

  // check without need to check timestamp specifically
  if (
    isSome(extensions) &&
    extensions.value[0].__kind === 'InterestBearingConfig'
  ) {
    t.is(extensions.value[0].rateAuthority, rateAuthority.address);
    t.true(typeof extensions.value[0].initializationTimestamp === 'bigint');
    t.true(typeof extensions.value[0].lastUpdateTimestamp === 'bigint');
    t.is(extensions.value[0].preUpdateAverageRate, rate);
    t.is(extensions.value[0].currentRate, rate);
  }

  t.like(mintAccount, <Account<Mint>>{
    address: mint.address,
  });
});
