import test from 'ava';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';
import { Account, generateKeyPairSigner, isSome } from '@solana/web3.js';
import {
  extension,
  fetchMint,
  getInitializeInterestBearingConfigInstruction,
  getUpdateInterestBearingConfigInstruction,
  Mint,
} from '../../../src';

test('updates interest-bearing configuration on a mint account', async (t) => {
  // Set up client and signer accounts
  const solClient = createDefaultSolanaClient();
  const [interestRateAuthority, mintAccount] = await Promise.all([
    generateKeyPairSignerWithSol(solClient),
    generateKeyPairSigner(),
  ]);

  // Define initial and new interest rates in basis points
  const initialInterestRate = 10000;
  const updatedInterestRate = 20000;

  // Configure interest-bearing extension for the mint account
  const interestBearingExtension = extension('InterestBearingConfig', {
    rateAuthority: interestRateAuthority.address,
    initializationTimestamp: BigInt(Math.floor(Date.now() / 1000)),
    lastUpdateTimestamp: BigInt(Math.floor(Date.now() / 1000)),
    preUpdateAverageRate: initialInterestRate,
    currentRate: initialInterestRate,
  });

  // Create and initialize the mint account with interest-bearing extension
  const [createMintInstr, initMintInstr] = await getCreateMintInstructions({
    authority: interestRateAuthority.address,
    client: solClient,
    extensions: [interestBearingExtension],
    mint: mintAccount,
    payer: interestRateAuthority,
  });

  await sendAndConfirmInstructions(solClient, interestRateAuthority, [
    createMintInstr,
    getInitializeInterestBearingConfigInstruction({
      rateAuthority: interestRateAuthority.address,
      mint: mintAccount.address,
      interestRateBasisPoints: initialInterestRate,
    }),
    initMintInstr,
    getUpdateInterestBearingConfigInstruction({
      rateAuthority: interestRateAuthority,
      mint: mintAccount.address,
      interestRateBasisPoints: updatedInterestRate,
    }),
  ]);

  // Verify mint account configuration after updating the interest rate
  const fetchedMintAccount = await fetchMint(solClient.rpc, mintAccount.address);
  const { extensions } = fetchedMintAccount.data;

  t.true(isSome(extensions));

  // Verify that the extension contains the correct interest-bearing config data
  if (isSome(extensions) && extensions.value[0].__kind === 'InterestBearingConfig') {
    t.is(extensions.value[0].rateAuthority, interestRateAuthority.address);
    t.is(extensions.value[0].preUpdateAverageRate, initialInterestRate);
    t.is(extensions.value[0].currentRate, updatedInterestRate);
  }

  t.like(fetchedMintAccount, <Account<Mint>>{
    address: mintAccount.address,
  });
});
