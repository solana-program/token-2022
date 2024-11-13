import { Account, address, generateKeyPairSigner, some } from '@solana/web3.js';
import test from 'ava';
import {
  Mint,
  extension,
  fetchMint,
  getUpdateInterestBearingMintInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it updates the interest rate on a mint with interest-bearing extension', async (t) => {
  // Given some signer accounts
  const client = createDefaultSolanaClient();
  const [authority, mint] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

  // And an interest-bearing extension with an initial rate
  const rateAuthority = address(
    '3bZ6bS8xjy9c5pVZ8dGFLxKtDpVzj2rVHTg8Zh1s8MgF'
  );
  const initialInterestRate = 500; // Initial interest rate in basis points
  const newInterestRate = 800; // New interest rate to be updated to in basis points
  const interestBearingExtension = extension('InterestBearingConfig', {
    authority: rateAuthority,
    rate: initialInterestRate,
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
    initMintInstruction,
  ]);

  // Now, update the interest rate on the initialized mint
  await sendAndConfirmInstructions(client, authority, [
    getUpdateInterestBearingMintInstruction({
      mint: mint.address,
      authority: some(rateAuthority),
      newRate: newInterestRate,
    }),
  ]);

  // Then we expect the mint account to exist with the updated interest rate
  const mintAccount = await fetchMint(client.rpc, mint.address);
  t.like(mintAccount, <Account<Mint>>{
    address: mint.address,
    data: {
      mintAuthority: some(authority.address),
      isInitialized: true,
      extensions: some([
        extension('InterestBearingConfig', {
          authority: rateAuthority,
          rate: newInterestRate,
        }),
      ]),
    },
  });
});
