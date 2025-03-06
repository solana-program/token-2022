import { Account, generateKeyPairSigner, some } from '@solana/kit';
import test from 'ava';
import {
  Token,
  extension,
  fetchToken,
  getEnableCpiGuardInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  createMint,
  createToken,
  generateKeyPairSignerWithSol,
  getCreateTokenInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it initializes a token account with an enabled CPI guard extension', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, token, owner] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);

  // And a mint account.
  const mint = await createMint({ authority, client, payer: authority });

  // When we create a token account and enable CPI guard.
  const cpiGuardExtension = extension('CpiGuard', {
    lockCpi: true,
  });
  const [createTokenInstruction, initTokenInstruction] =
    await getCreateTokenInstructions({
      client,
      extensions: [cpiGuardExtension],
      mint,
      owner: owner.address,
      payer: authority,
      token,
    });
  await sendAndConfirmInstructions(client, authority, [
    createTokenInstruction,
    initTokenInstruction,
    getEnableCpiGuardInstruction({
      token: token.address,
      owner,
    }),
  ]);

  // Then we expect the token account to exist and have the following extension.
  const tokenAccount = await fetchToken(client.rpc, token.address);
  t.like(tokenAccount, <Account<Token>>{
    address: token.address,
    data: {
      extensions: some([cpiGuardExtension]),
    },
  });
});

test('it enables CPI guard on a token account', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, owner] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSignerWithSol(client),
  ]);

  // And a token account with a disabled CPI guard extension.
  const mint = await createMint({ authority, client, payer: authority });
  const token = await createToken({
    client,
    extensions: [extension('CpiGuard', { lockCpi: false })],
    mint,
    owner,
    payer: authority,
  });

  // When we enable the CPI guard extension.
  await sendAndConfirmInstructions(client, owner, [
    getEnableCpiGuardInstruction({ token, owner }),
  ]);

  // Then we expect the token account to have CPI guard enabled.
  const tokenAccount = await fetchToken(client.rpc, token);
  t.deepEqual(
    tokenAccount.data.extensions,
    some([extension('CpiGuard', { lockCpi: true })])
  );
});
