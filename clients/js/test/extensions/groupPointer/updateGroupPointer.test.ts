import { Account, address, generateKeyPairSigner, some } from '@solana/kit';
import test from 'ava';
import {
  Mint,
  extension,
  fetchMint,
  getUpdateGroupPointerInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  createMint,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it updates the group pointer extension on a mint account', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, groupPointerAuthority] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);
  const oldGroup = address('8dtp4b6tB8EhLpSG1jgg4swSQtUKRst2f7rJYSwE2Me3');
  const newGroup = address('88F35KbnWKPeMnKFJDxZVjvEWmGms1FxW6wP52VABCVt');

  // And a mint account initialized with a group pointer extension.
  const mint = await createMint({
    authority,
    client,
    extensions: [
      extension('GroupPointer', {
        authority: groupPointerAuthority.address,
        groupAddress: oldGroup,
      }),
    ],
    payer: authority,
  });

  // When we update the group pointer on the mint account.
  await sendAndConfirmInstructions(client, authority, [
    getUpdateGroupPointerInstruction({
      mint,
      groupPointerAuthority,
      groupAddress: newGroup,
    }),
  ]);

  // Then we expect the mint account to have the following updated data.
  const mintAccount = await fetchMint(client.rpc, mint);
  t.like(mintAccount, <Account<Mint>>{
    address: mint,
    data: {
      extensions: some([
        extension('GroupPointer', {
          authority: some(groupPointerAuthority.address),
          groupAddress: some(newGroup),
        }),
      ]),
    },
  });
});
