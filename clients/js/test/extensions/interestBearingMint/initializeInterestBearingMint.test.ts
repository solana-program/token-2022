import { Account, generateKeyPairSigner, some } from '@solana/web3.js';
import test from 'ava';
import {
  fetchMint,
  extension,
  Mint,
  getInitializeInterestBearingConfigInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('initializes interest-bearing mint with specified configuration', async (t) => {
  // Set up Solana client and signer accounts
  const solClient = createDefaultSolanaClient();
  const [mintAuthority, mintAccount] = await Promise.all([
    generateKeyPairSignerWithSol(solClient),
    generateKeyPairSigner(),
  ]);

  // Define initial interest rate and configure interest-bearing extension
  const baseInterestRate = 10000;
  const interestConfigExtension = extension('InterestBearingConfig', {
    rateAuthority: mintAuthority.address,
    initializationTimestamp: BigInt(Math.floor(Date.now() / 1000)),
    lastUpdateTimestamp: BigInt(Math.floor(Date.now() / 1000)),
    preUpdateAverageRate: baseInterestRate,
    currentRate: baseInterestRate,
  });

  // Prepare instructions for creating and initializing the mint account
  const [createMintInstr, initMintInstr] = await getCreateMintInstructions({
    authority: mintAuthority.address,
    client: solClient,
    extensions: [interestConfigExtension],
    mint: mintAccount,
    payer: mintAuthority,
  });

  await sendAndConfirmInstructions(solClient, mintAuthority, [
    createMintInstr,
    getInitializeInterestBearingConfigInstruction({
      rateAuthority: mintAuthority.address,
      mint: mintAccount.address,
      interestRateBasisPoints: baseInterestRate,
    }),
    initMintInstr,
  ]);

  // Verify the mint account configuration, including interest-bearing extension
  const fetchedMintAccount = await fetchMint(
    solClient.rpc,
    mintAccount.address
  );
  t.like(fetchedMintAccount, <Account<Mint>>{
    address: mintAccount.address,
    data: {
      mintAuthority: some(mintAuthority.address),
      isInitialized: true,
      extensions: some([interestConfigExtension]),
    },
  });
});
