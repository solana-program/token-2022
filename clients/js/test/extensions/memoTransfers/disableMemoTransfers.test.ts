import { Account, generateKeyPairSigner, some } from '@solana/kit';
import test from 'ava';
import {
  Token,
  extension,
  fetchToken,
  getDisableMemoTransfersInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  createMint,
  createToken,
  generateKeyPairSignerWithSol,
  getCreateTokenInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it initializes a token account with a disabled memo transfers extension', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, token, owner] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);

  // And a mint account.
  const mint = await createMint({ authority, client, payer: authority });

  // When we create a token account and disable memo transfers.
  const memoTransfersExtension = extension('MemoTransfer', {
    requireIncomingTransferMemos: false,
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
    getDisableMemoTransfersInstruction({ token: token.address, owner }),
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

test('it disables an active memo transfers extension', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, owner] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

  // And a token account with an active memo transfers extension.
  const mint = await createMint({ authority, client, payer: authority });
  const token = await createToken({
    client,
    extensions: [
      extension('MemoTransfer', { requireIncomingTransferMemos: true }),
    ],
    mint,
    owner,
    payer: authority,
  });

  // When we disable the memo transfers extension.
  await sendAndConfirmInstructions(client, authority, [
    getDisableMemoTransfersInstruction({ token, owner }),
  ]);

  // Then we expect the token account to have the extension disabled.
  const tokenAccount = await fetchToken(client.rpc, token);
  t.deepEqual(
    tokenAccount.data.extensions,
    some([extension('MemoTransfer', { requireIncomingTransferMemos: false })])
  );
});
