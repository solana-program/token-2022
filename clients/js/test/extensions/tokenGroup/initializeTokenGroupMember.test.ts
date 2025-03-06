import { generateKeyPairSigner, none, some, unwrapOption } from '@solana/kit';
import test from 'ava';
import {
  extension,
  fetchMint,
  getInitializeTokenGroupMemberInstruction,
  isExtension,
  Mint,
} from '../../../src';
import {
  createDefaultSolanaClient,
  createMint,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it adds members to the token group extension', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, group, member, groupUpdateAuthority] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);

  // And a group mint account initialized with the token group and group pointer extensions.
  await createMint({
    authority,
    client,
    extensions: [
      extension('GroupPointer', {
        authority: authority.address,
        groupAddress: group.address,
      }),
      extension('TokenGroup', {
        updateAuthority: groupUpdateAuthority.address,
        mint: group.address,
        size: 0n,
        maxSize: 20_000n,
      }),
    ],
    mint: group,
    payer: authority,
  });

  // And a member mint account with the group member pointer and the token group member extensions.
  const memberExtensions = [
    extension('GroupMemberPointer', {
      authority: none(),
      memberAddress: some(member.address),
    }),
    extension('TokenGroupMember', {
      mint: member.address,
      group: group.address,
      memberNumber: 1n,
    }),
  ];
  await createMint({
    authority,
    client,
    extensions: memberExtensions,
    mint: member,
    payer: authority,
  });

  // When we initialize the member mint account as a member of the group mint account.
  await sendAndConfirmInstructions(client, authority, [
    getInitializeTokenGroupMemberInstruction({
      member: member.address,
      memberMint: member.address,
      memberMintAuthority: authority,
      group: group.address,
      groupUpdateAuthority,
    }),
  ]);

  // Then we expect the member mint account to have the following extensions
  const memberAccount = await fetchMint(client.rpc, member.address);
  t.like(memberAccount.data, <Mint>{
    extensions: some(memberExtensions),
  });

  // And we expect the size of the group mint account to be updated accordingly.
  const groupAccount = await fetchMint(client.rpc, group.address);
  const tokenGroupExtension = unwrapOption(groupAccount.data.extensions)?.find(
    (e) => isExtension('TokenGroup', e)
  );
  t.is(tokenGroupExtension?.size, 1n);
});
