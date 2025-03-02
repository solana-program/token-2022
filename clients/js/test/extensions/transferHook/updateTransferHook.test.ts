import { Account, address, generateKeyPairSigner, some } from '@solana/kit';
import test from 'ava';
import {
  Mint,
  extension,
  fetchMint,
  getUpdateTransferHookInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  createMint,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it updates transfer hook program ID on a mint', async (t) => {
  // Given some signer accounts and client
  const client = createDefaultSolanaClient();
  const [authority, hookAuthority] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

  // And a mint with initial transfer hook configuration
  const oldProgramId = address('BTNEPmmWuj7Sg4Fo5i1FC5eiV2Aj4jiv9boarvE5XeaX');
  const transferHookExtension = extension('TransferHook', {
    authority: hookAuthority.address,
    programId: oldProgramId,
  });

  const mint = await createMint({
    authority,
    client,
    extensions: [transferHookExtension],
    payer: authority,
  });

  // When we update the program ID
  const newProgramId = address('6sPR6MzvjMMP5LSZzEtTe4ZBVX9rhBmtM1dmfFtkNTbW');
  await sendAndConfirmInstructions(client, authority, [
    getUpdateTransferHookInstruction({
      mint,
      authority: hookAuthority,
      programId: some(newProgramId),
    }),
  ]);

  // Then we expect the mint to have the updated program ID
  const mintAccount = await fetchMint(client.rpc, mint);
  t.like(mintAccount, <Account<Mint>>{
    address: mint,
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
