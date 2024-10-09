import { Account, generateKeyPairSigner, some } from '@solana/web3.js';
import test from 'ava';
import {
  Token,
  extension,
  fetchToken,
  getEnableMemoTransfersInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  createMint,
  generateKeyPairSignerWithSol,
  getCreateTokenInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it initializes a token account with an active memo transfers extension', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, token, owner] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);

  // And a mint account.
  const mint = await createMint({
    authority: authority.address,
    client,
    payer: authority,
  });

  // When we create a token account and enable memo transfers.
  const memoTransfersExtension = extension('MemoTransfer', {
    requireIncomingTransferMemos: true,
  });
  const [createTokenInstruction, initTokenInstruction] =
    await getCreateTokenInstructions({
      client,
      extensions: [memoTransfersExtension],
      mint,
      owner: owner.address,
      payer: authority,
      token,
    });
  await sendAndConfirmInstructions(client, authority, [
    createTokenInstruction,
    initTokenInstruction,
    getEnableMemoTransfersInstruction({ token: token.address, owner }),
  ]);

  // Then we expect the token account to exist and have the following extension.
  const tokenAccount = await fetchToken(client.rpc, token.address);
  t.like(tokenAccount, <Account<Token>>{
    address: token.address,
    data: {
      extensions: some([memoTransfersExtension]),
    },
  });
});
