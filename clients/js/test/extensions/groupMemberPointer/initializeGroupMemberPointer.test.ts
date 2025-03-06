import { Account, generateKeyPairSigner, some } from '@solana/kit';
import test from 'ava';
import {
  Mint,
  extension,
  fetchMint,
  getInitializeGroupMemberPointerInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it initializes a mint account with a group member pointer extension', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, mint, groupMember, groupMemberPointerAuthority] =
    await Promise.all([
      generateKeyPairSignerWithSol(client),
      generateKeyPairSigner(),
      generateKeyPairSigner(),
      generateKeyPairSigner(),
    ]);

  // And a group member pointer extension.
  const groupMemberPointerExtension = extension('GroupMemberPointer', {
    authority: some(groupMemberPointerAuthority.address),
    memberAddress: some(groupMember.address),
  });

  // When we create and initialize a mint account with this extension.
  const [createMintInstruction, initMintInstruction] =
    await getCreateMintInstructions({
      authority: authority.address,
      client,
      extensions: [groupMemberPointerExtension],
      mint,
      payer: authority,
    });
  await sendAndConfirmInstructions(client, authority, [
    createMintInstruction,
    getInitializeGroupMemberPointerInstruction({
      mint: mint.address,
      authority: groupMemberPointerExtension.authority,
      memberAddress: groupMemberPointerExtension.memberAddress,
    }),
    initMintInstruction,
  ]);

  // Then we expect the mint account to exist and have the following extension.
  const mintAccount = await fetchMint(client.rpc, mint.address);
  t.like(mintAccount, <Account<Mint>>{
    address: mint.address,
    data: {
      extensions: some([groupMemberPointerExtension]),
    },
  });
});
