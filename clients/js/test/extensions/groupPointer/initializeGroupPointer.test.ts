import { Account, generateKeyPairSigner, some } from '@solana/kit';
import test from 'ava';
import {
  Mint,
  extension,
  fetchMint,
  getInitializeGroupPointerInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it initializes a mint account with a group pointer extension', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, mint, group, groupPointerAuthority] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);

  // And a group pointer extension.
  const groupPointerExtension = extension('GroupPointer', {
    authority: some(groupPointerAuthority.address),
    groupAddress: some(group.address),
  });

  // When we create and initialize a mint account with this extension.
  const [createMintInstruction, initMintInstruction] =
    await getCreateMintInstructions({
      authority: authority.address,
      client,
      extensions: [groupPointerExtension],
      mint,
      payer: authority,
    });
  await sendAndConfirmInstructions(client, authority, [
    createMintInstruction,
    getInitializeGroupPointerInstruction({
      mint: mint.address,
      authority: groupPointerExtension.authority,
      groupAddress: groupPointerExtension.groupAddress,
    }),
    initMintInstruction,
  ]);

  // Then we expect the mint account to exist and have the following extension.
  const mintAccount = await fetchMint(client.rpc, mint.address);
  t.like(mintAccount, <Account<Mint>>{
    address: mint.address,
    data: {
      extensions: some([groupPointerExtension]),
    },
  });
});
