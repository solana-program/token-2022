// import test from 'ava';
// import {
//   createDefaultSolanaClient,
//   generateKeyPairSignerWithSol,
//   getCreateMintInstructions,
//   sendAndConfirmInstructions,
// } from '../../_setup';
// import { Account, generateKeyPairSigner, isSome } from '@solana/web3.js';
// import {
//   extension,
//   fetchMint,
//   getInitializeScaledUiAmountMintInstruction,
//   Mint,
// } from '../../../src';

// test('it initialize a mint account with an interest bearing mint extension', async (t) => {
//   const client = createDefaultSolanaClient();
//   const [multiplierAuthority, mint] = await Promise.all([
//     generateKeyPairSignerWithSol(client),
//     generateKeyPairSigner(),
//   ]);

//   const newMultiplier = 2;

//   // And a scaled ui amount mint extension.
//   const scaledUiAmountMintExtension = extension('ScaledUiAmountConfig', {
//     authority: multiplierAuthority.address,
//     multiplier: 1,
//     newMultiplierEffectiveTimestamp: BigInt(Math.floor(new Date().getTime() / 1000)),
//     newMultiplier,
//   });

//   // When we initialize the mint account with the scaled ui amount mint extension.
//   const [createMintInstruction, initMintInstruction] =
//     await getCreateMintInstructions({
//       authority: multiplierAuthority.address,
//       client,
//       extensions: [scaledUiAmountMintExtension],
//       mint,
//       payer: multiplierAuthority,
//     });
//   await sendAndConfirmInstructions(client, multiplierAuthority, [
//     createMintInstruction,
//     getInitializeScaledUiAmountMintInstruction({
//       mint: mint.address,
//       authority: multiplierAuthority.address,
//       multiplier: 1,
//     }),
//     initMintInstruction,
//   ]);

//   const mintAccount = await fetchMint(client.rpc, mint.address);

//   const extensions = mintAccount.data.extensions;

//   t.true(isSome(extensions));
//   t.true(
//     isSome(extensions) && extensions.value[0].__kind === 'ScaledUiAmountConfig'
//   );

//   // check without need to check timestamp specifically
//   if (
//     isSome(extensions) &&
//     extensions.value[0].__kind === 'ScaledUiAmountConfig'
//   ) {
//     t.is(extensions.value[0].authority, multiplierAuthority.address);
//     t.is(extensions.value[0].multiplier, 1);
//     t.true(typeof extensions.value[0].newMultiplierEffectiveTimestamp === 'bigint');
//     t.is(extensions.value[0].newMultiplier, newMultiplier);
//   }

//   t.like(mintAccount, <Account<Mint>>{
//     address: mint.address,
//   });
// });