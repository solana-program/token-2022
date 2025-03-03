import { Account, address, generateKeyPairSigner, some } from '@solana/kit';
import test from 'ava';
import {
  Mint,
  extension,
  fetchMint,
  getInitializePermanentDelegateInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it initializes a mint with permanent delegate', async (t) => {
  // Given some signer accounts
  const client = createDefaultSolanaClient();
  const [authority, mint] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

  // And a permanent delegate extension
  const permanentDelegate = address(
    '6sPR6MzvjMMP5LSZzEtTe4ZBVX9rhBmtM1dmfFtkNTbW'
  );
  const permanentDelegateExtension = extension('PermanentDelegate', {
    delegate: permanentDelegate,
  });

  // When we create and initialize a mint account with this extension
  const [createMintInstruction, initMintInstruction] =
    await getCreateMintInstructions({
      authority: authority.address,
      client,
      extensions: [permanentDelegateExtension],
      mint,
      payer: authority,
    });

  await sendAndConfirmInstructions(client, authority, [
    createMintInstruction,
    getInitializePermanentDelegateInstruction({
      mint: mint.address,
      delegate: permanentDelegate,
    }),
    initMintInstruction,
  ]);

  // Then we expect the mint account to exist with the permanent delegate
  const mintAccount = await fetchMint(client.rpc, mint.address);
  t.like(mintAccount, <Account<Mint>>{
    address: mint.address,
    data: {
      mintAuthority: some(authority.address),
      isInitialized: true,
      extensions: some([permanentDelegateExtension]),
    },
  });
});
