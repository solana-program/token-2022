import { generateKeyPairSigner, unwrapOption } from '@solana/web3.js';
import test from 'ava';
import {
  extension,
  fetchMint,
  getInitializeTokenGroupMemberInstruction,
  isExtension,
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

  // And a member mint account with a group member pointer extension pointing to itself.
  await createMint({
    authority,
    client,
    extensions: [
      extension('GroupMemberPointer', {
        authority: null,
        memberAddress: member.address,
      }),
    ],
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

  // Then we expect the size of the group mint account to be updated accordingly.
  const mintAccount = await fetchMint(client.rpc, group.address);
  const tokenGroupExtension = unwrapOption(mintAccount.data.extensions)?.find(
    (e) => isExtension('TokenGroup', e)
  );
  t.is(tokenGroupExtension?.size, 1n);
});
