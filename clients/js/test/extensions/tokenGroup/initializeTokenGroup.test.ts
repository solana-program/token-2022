import { Account, generateKeyPairSigner, some } from '@solana/kit';
import test from 'ava';
import {
  Mint,
  extension,
  fetchMint,
  getInitializeGroupPointerInstruction,
  getInitializeTokenGroupInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it initializes a mint account with a token group and group pointer extension', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, mint, updateAuthority] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);

  // And a token group extension.
  const tokenGroupExtension = extension('TokenGroup', {
    updateAuthority: some(updateAuthority.address),
    mint: mint.address,
    size: 0n,
    maxSize: 20_000n,
  });

  // And a group pointer extension pointing to itself.
  const groupPointerExtension = extension('GroupPointer', {
    authority: some(authority.address),
    groupAddress: some(mint.address),
  });

  // When we create and initialize a mint account with these extensions.
  const [createMintInstruction, initMintInstruction] =
    await getCreateMintInstructions({
      authority: authority.address,
      client,
      extensions: [groupPointerExtension, tokenGroupExtension],
      mint,
      payer: authority,
    });
  await sendAndConfirmInstructions(client, authority, [
    createMintInstruction,
    getInitializeGroupPointerInstruction({
      mint: mint.address,
      authority: authority.address,
      groupAddress: mint.address,
    }),
    initMintInstruction,
    getInitializeTokenGroupInstruction({
      group: mint.address,
      updateAuthority: updateAuthority.address,
      mint: mint.address,
      mintAuthority: authority,
      maxSize: tokenGroupExtension.maxSize,
    }),
  ]);

  // Then we expect the mint account to exist and have the following extension.
  const mintAccount = await fetchMint(client.rpc, mint.address);
  t.like(mintAccount, <Account<Mint>>{
    address: mint.address,
    data: {
      extensions: some([groupPointerExtension, tokenGroupExtension]),
    },
  });
});
