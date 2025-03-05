import test from 'ava';
import {
  createDefaultSolanaClient,
  createMint,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from '../../_setup';
import { Account, isSome } from '@solana/web3.js';
import {
  extension,
  fetchMint,
  getUpdateMultiplierScaledUiMintInstruction,
  Mint,
} from '../../../src';

test('it updates the multiplier of the scaled ui amount mint extension on a mint account', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [multiplierAuthority] = await Promise.all([
    generateKeyPairSignerWithSol(client),
  ]);

  const oldMultiplier = 1;
  const newMultiplier = 2;

  // initialize mint with scaled ui amount mint extension
  const mint = await createMint({
    authority: multiplierAuthority,
    client,
    extensions: [
      extension('ScaledUiAmountConfig', {
        authority: multiplierAuthority.address,
        multiplier: oldMultiplier,
        newMultiplierEffectiveTimestamp: BigInt(
          Math.floor(new Date().getTime() * 2)
        ),
        newMultiplier: oldMultiplier,
      }),
    ],
    payer: multiplierAuthority,
  });

  // then we update the interest bearing mint extension on the mint account
  await sendAndConfirmInstructions(client, multiplierAuthority, [
    getUpdateMultiplierScaledUiMintInstruction({
      mint,
      authority: multiplierAuthority.address,
      multiplier: newMultiplier,
      effectiveTimestamp: BigInt(Math.floor(new Date().getTime() / 1000)),
    }),
  ]);

  const mintAccount = await fetchMint(client.rpc, mint);

  // check without need to check timestamp specifically
  const extensions = mintAccount.data.extensions;

  t.true(isSome(extensions));
  t.true(
    isSome(extensions) && extensions.value[0].__kind === 'ScaledUiAmountConfig'
  );

  if (
    isSome(extensions) &&
    extensions.value[0].__kind === 'ScaledUiAmountConfig'
  ) {
    t.is(extensions.value[0].authority, multiplierAuthority.address);
    t.true(typeof extensions.value[0].multiplier === 'number');
    t.true(
      typeof extensions.value[0].newMultiplierEffectiveTimestamp === 'bigint'
    );
    t.is(extensions.value[0].newMultiplier, newMultiplier);
  }

  t.like(mintAccount, <Account<Mint>>{
    address: mint,
  });
});
