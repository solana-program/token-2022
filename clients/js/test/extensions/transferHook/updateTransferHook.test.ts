import { Account, address, generateKeyPairSigner, some } from '@solana/web3.js';
import test from 'ava';
import {
  Mint,
  extension,
  fetchMint,
  getInitializeTransferHookInstruction,
  getUpdateTransferHookInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it updates transfer hook program ID on a mint', async (t) => {
  // Given some signer accounts
  const client = createDefaultSolanaClient();
  const [authority, mint, hookAuthority] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);

  // And a mint with transfer hook extension
  const oldProgramId = address('BTNEPmmWuj7Sg4Fo5i1FC5eiV2Aj4jiv9boarvE5XeaX');
  const transferHookExtension = extension('TransferHook', {
    authority: hookAuthority.address,
    programId: oldProgramId,
  });

  // Initialize the mint with transfer hook
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
      authority: some(hookAuthority.address),
      programId: some(oldProgramId),
    }),
    initMintInstruction,
  ]);

  // When we update the program ID
  const newProgramId = address('6sPR6MzvjMMP5LSZzEtTe4ZBVX9rhBmtM1dmfFtkNTbW');
  await sendAndConfirmInstructions(client, authority, [
    getUpdateTransferHookInstruction({
      mint: mint.address,
      authority: hookAuthority,
      programId: some(newProgramId),
    }),
  ]);

  // Then we expect the mint to have the updated program ID
  const mintAccount = await fetchMint(client.rpc, mint.address);
  t.like(mintAccount, <Account<Mint>>{
    address: mint.address,
    data: {
      extensions: some([
        extension('TransferHook', {
          authority: hookAuthority.address,
          programId: newProgramId,
        }),
      ]),
    },
  });
});
