import { Account, address, generateKeyPairSigner, some } from '@solana/web3.js';
import test from 'ava';
import {
  getInitializeInterestBearingMintInstruction,
  fetchMint,
  extension,
  Mint,
} from '../../../src'; // Assuming these functions are defined in your code
import {
  createDefaultSolanaClient,
  createMint,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from '../../_setup'; // Assuming these are already defined in your setup

test('initialize interest-bearing mint', async (t) => {
  // Given a client and signer accounts
  const client = createDefaultSolanaClient();
  const [authority] = await Promise.all([
    generateKeyPairSignerWithSol(client),
  ]);

  // And the rate authority (the account that can update the rate)
  const initialRate = 1; // Example initial rate
  const rateAuthority = address(
    '3bZ6bS8xjy9c5pVZ8dGFLxKtDpVzj2rVHTg8Zh1s8MgF'
  );
  const interestDelegateExtension = extension('InterestBearingConfig', {
    rateAuthority: rateAuthority,
    currentRate: initialRate
  });

  // When we create a mint with this extension
  const mintAddress = await createMint({
    authority,
    client,
    extensions: [interestDelegateExtension],
    payer: authority,
  });


  // Then we expect the mint account to exist with the permanent delegate
  const mintAccount = await fetchMint(client.rpc, mintAddress);
  t.like(mintAccount, <Account<Mint>>{
    address: mintAddress,
    data: {
      mintAuthority: some(authority.address),
      isInitialized: true,
      extensions: some([interestDelegateExtension]),
    },
  });
});
