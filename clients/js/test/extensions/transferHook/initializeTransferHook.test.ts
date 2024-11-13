import { Account, address, some } from '@solana/web3.js';
import test from 'ava';
import { Mint, extension, fetchMint } from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  createMint,
} from '../../_setup';

test('it initializes a mint with transfer hook extension', async (t) => {
  // Given some signer accounts and client
  const client = createDefaultSolanaClient();
  const authority = await generateKeyPairSignerWithSol(client);

  // And a transfer hook extension
  const transferHookExtension = extension('TransferHook', {
    authority: address('6sPR6MzvjMMP5LSZzEtTe4ZBVX9rhBmtM1dmfFtkNTbW'),
    programId: address('BTNEPmmWuj7Sg4Fo5i1FC5eiV2Aj4jiv9boarvE5XeaX'),
  });

  // When we create a mint with the transfer hook extension
  const mintAddress = await createMint({
    authority,
    client,
    extensions: [transferHookExtension],
    payer: authority,
  });

  // Then we expect the mint account to exist with the transfer hook extension
  const mintAccount = await fetchMint(client.rpc, mintAddress);
  t.like(mintAccount, <Account<Mint>>{
    address: mintAddress,
    data: {
      mintAuthority: some(authority.address),
      isInitialized: true,
      extensions: some([transferHookExtension]),
    },
  });
});
