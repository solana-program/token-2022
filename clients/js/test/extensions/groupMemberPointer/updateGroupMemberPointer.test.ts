import { Account, address, generateKeyPairSigner, some } from '@solana/kit';
import test from 'ava';
import {
  Mint,
  extension,
  fetchMint,
  getUpdateGroupMemberPointerInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  createMint,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it updates the group member pointer extension on a mint account', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, groupMemberPointerAuthority] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);
  const oldMember = address('8dtp4b6tB8EhLpSG1jgg4swSQtUKRst2f7rJYSwE2Me3');
  const newMember = address('88F35KbnWKPeMnKFJDxZVjvEWmGms1FxW6wP52VABCVt');

  // And a mint account initialized with a group member pointer extension.
  const mint = await createMint({
    authority,
    client,
    extensions: [
      extension('GroupMemberPointer', {
        authority: groupMemberPointerAuthority.address,
        memberAddress: oldMember,
      }),
    ],
    payer: authority,
  });

  // When we update the group member pointer on the mint account.
  await sendAndConfirmInstructions(client, authority, [
    getUpdateGroupMemberPointerInstruction({
      mint,
      groupMemberPointerAuthority,
      memberAddress: newMember,
    }),
  ]);

  // Then we expect the mint account to have the following updated data.
  const mintAccount = await fetchMint(client.rpc, mint);
  t.like(mintAccount, <Account<Mint>>{
    address: mint,
    data: {
      extensions: some([
        extension('GroupMemberPointer', {
          authority: some(groupMemberPointerAuthority.address),
          memberAddress: some(newMember),
        }),
      ]),
    },
  });
});
