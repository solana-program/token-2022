import { Account, address, generateKeyPairSigner, some } from '@solana/web3.js';
import test from 'ava';
import {
  Mint,
  extension,
  fetchMint,
  getInitializeInterestBearingMintInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it initializes a mint with interest-bearing extension', async (t) => {
  // Given some signer accounts
  const client = createDefaultSolanaClient();
  const [authority, mint] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

  // And an interest-bearing extension
  const rateAuthority = address(
    '3bZ6bS8xjy9c5pVZ8dGFLxKtDpVzj2rVHTg8Zh1s8MgF'
  );
  const interestRate = 500; // Example interest rate in basis points
  const interestBearingExtension = extension('InterestBearingConfig', {
    authority: rateAuthority,
    rate: interestRate,
  });

  // When we create and initialize a mint account with this extension
  const [createMintInstruction, initMintInstruction] =
    await getCreateMintInstructions({
      authority: authority.address,
      client,
      extensions: [interestBearingExtension],
      mint,
      payer: authority,
    });

  await sendAndConfirmInstructions(client, authority, [
    createMintInstruction,
    getInitializeInterestBearingMintInstruction({
      mint: mint.address,
      authority: some(rateAuthority),
      interestRateBasisPoints: interestRate,
    }),
    initMintInstruction,
  ]);

  // Then we expect the mint account to exist with the interest-bearing extension
  const mintAccount = await fetchMint(client.rpc, mint.address);
  t.like(mintAccount, <Account<Mint>>{
    address: mint.address,
    data: {
      mintAuthority: some(authority.address),
      isInitialized: true,
      extensions: some([interestBearingExtension]),
    },
  });
});
