import { Account, generateKeyPairSigner, some } from '@solana/web3.js';
import test from 'ava';
import {
  AccountState,
  Mint,
  extension,
  fetchMint,
  getInitializeDefaultAccountStateInstruction,
  getUpdateDefaultAccountStateInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it updates the default state account on a mint account', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, freezeAuthority, mint] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);

  // And a mint account initialized with a default account state extension.
  const defaultAccountStateExtension = extension('DefaultAccountState', {
    state: AccountState.Frozen,
  });
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

  // When we update the default account state on the mint account.
  await sendAndConfirmInstructions(client, authority, [
    getUpdateDefaultAccountStateInstruction({
      mint: mint.address,
      freezeAuthority,
      state: AccountState.Initialized,
    }),
  ]);

  // Then we expect the mint account to have the following updated data.
  const mintAccount = await fetchMint(client.rpc, mint.address);
  t.like(mintAccount, <Account<Mint>>{
    address: mint.address,
    data: {
      extensions: some([
        extension('DefaultAccountState', { state: AccountState.Initialized }),
      ]),
    },
  });
});
