import { Account, address, some } from '@solana/web3.js';
import test from 'ava';
import { Mint, extension, fetchMint } from '../../../src';
import {
  createDefaultSolanaClient,
  createMint,
  generateKeyPairSignerWithSol,
} from '../../_setup';

test('it initializes a mint with permanent delegate', async (t) => {
  // Given some signer accounts
  const client = createDefaultSolanaClient();
  const [authority] = await Promise.all([generateKeyPairSignerWithSol(client)]);

  // And a permanent delegate extension
  const permanentDelegate = address(
    '6sPR6MzvjMMP5LSZzEtTe4ZBVX9rhBmtM1dmfFtkNTbW'
  );
  const permanentDelegateExtension = extension('PermanentDelegate', {
    delegate: permanentDelegate,
  });

  // When we create a mint with this extension
  const mintAddress = await createMint({
    authority,
    client,
    extensions: [permanentDelegateExtension],
    payer: authority,
  });

  // Then we expect the mint account to exist with the permanent delegate
  const mintAccount = await fetchMint(client.rpc, mintAddress);
  t.like(mintAccount, <Account<Mint>>{
    address: mintAddress,
    data: {
      mintAuthority: some(authority.address),
      isInitialized: true,
      extensions: some([permanentDelegateExtension]),
    },
  });
});
