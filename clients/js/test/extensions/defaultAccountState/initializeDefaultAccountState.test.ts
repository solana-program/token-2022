import { Account, generateKeyPairSigner, some } from '@solana/kit';
import test from 'ava';
import {
  AccountState,
  Mint,
  extension,
  fetchMint,
  fetchToken,
  getInitializeDefaultAccountStateInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  createMint,
  createToken,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it initializes a mint account with a default account state extension', async (t) => {
  // Given an authority and a mint account.
  const client = createDefaultSolanaClient();
  const [authority, freezeAuthority, mint] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);

  // And a default account state extension.
  const defaultAccountStateExtension = extension('DefaultAccountState', {
    state: AccountState.Frozen,
  });

  // When we create and initialize a mint account with this extension.
  const [createMintInstruction, initMintInstruction] =
    await getCreateMintInstructions({
      authority: authority.address,
      client,
      extensions: [defaultAccountStateExtension],
      freezeAuthority: freezeAuthority.address,
      mint,
      payer: authority,
    });
  await sendAndConfirmInstructions(client, authority, [
    createMintInstruction,
    getInitializeDefaultAccountStateInstruction({
      mint: mint.address,
      state: defaultAccountStateExtension.state,
    }),
    initMintInstruction,
  ]);

  // Then we expect the mint account to exist and have the following data.
  const mintAccount = await fetchMint(client.rpc, mint.address);
  t.like(mintAccount, <Account<Mint>>{
    address: mint.address,
    data: {
      mintAuthority: some(authority.address),
      isInitialized: true,
      extensions: some([defaultAccountStateExtension]),
    },
  });
});

test('it initializes a token account with the default state defined on the mint account', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, freezeAuthority, owner] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);

  // And a mint account initialized with a default account state extension.
  const mint = await createMint({
    authority,
    client,
    extensions: [
      extension('DefaultAccountState', { state: AccountState.Frozen }),
    ],
    freezeAuthority: freezeAuthority.address,
    payer: authority,
  });

  // When we create a new token account for the mint.
  const token = await createToken({ client, mint, owner, payer: authority });

  // Then we expect the token account to have the default state defined on the mint account.
  const tokenAccount = await fetchToken(client.rpc, token);
  t.is(tokenAccount.data.state, AccountState.Frozen);
});
