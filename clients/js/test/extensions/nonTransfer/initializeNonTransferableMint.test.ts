import { Account, generateKeyPairSigner, some } from '@solana/kit';
import test from 'ava';
import {
  Mint,
  extension,
  fetchMint,
  getInitializeNonTransferableMintInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it initializes a non-transferable mint', async (t) => {
  // Given an authority and a mint account.
  const client = createDefaultSolanaClient();
  const [authority, mint] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

  // When we create and initialize a mint account as non-transferable
  const [createMintInstruction, initMintInstruction] =
    await getCreateMintInstructions({
      authority: authority.address,
      client,
      extensions: [extension('NonTransferable', {})],
      mint,
      payer: authority,
    });

  await sendAndConfirmInstructions(client, authority, [
    createMintInstruction,
    getInitializeNonTransferableMintInstruction({
      mint: mint.address,
    }),
    initMintInstruction,
  ]);

  // Then we expect the mint to be initialized with the non-transferable extension
  const mintAccount = await fetchMint(client.rpc, mint.address);
  t.like(mintAccount, <Account<Mint>>{
    address: mint.address,
    data: {
      mintAuthority: some(authority.address),
      isInitialized: true,
      extensions: some([extension('NonTransferable', {})]),
    },
  });
});
