import { Account, address, generateKeyPairSigner, some } from '@solana/kit';
import test from 'ava';
import {
  Mint,
  extension,
  fetchMint,
  getInitializeTransferHookInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it initializes a mint with transfer hook extension', async (t) => {
  // Given some signer accounts
  const client = createDefaultSolanaClient();
  const [authority, mint] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

  // And a transfer hook extension
  const transferHookAuthority = address(
    '6sPR6MzvjMMP5LSZzEtTe4ZBVX9rhBmtM1dmfFtkNTbW'
  );
  const transferHookProgramId = address(
    'BTNEPmmWuj7Sg4Fo5i1FC5eiV2Aj4jiv9boarvE5XeaX'
  );
  const transferHookExtension = extension('TransferHook', {
    authority: transferHookAuthority,
    programId: transferHookProgramId,
  });

  // When we create and initialize a mint account with this extension
  const [createMintInstruction, initMintInstruction] =
    await getCreateMintInstructions({
      authority: authority.address,
      client,
      extensions: [transferHookExtension],
      mint,
      payer: authority,
    });

  await sendAndConfirmInstructions(client, authority, [
    createMintInstruction,
    getInitializeTransferHookInstruction({
      mint: mint.address,
      authority: some(transferHookAuthority),
      programId: some(transferHookProgramId),
    }),
    initMintInstruction,
  ]);

  // Then we expect the mint account to exist with the transfer hook extension
  const mintAccount = await fetchMint(client.rpc, mint.address);
  t.like(mintAccount, <Account<Mint>>{
    address: mint.address,
    data: {
      mintAuthority: some(authority.address),
      isInitialized: true,
      extensions: some([transferHookExtension]),
    },
  });
});
