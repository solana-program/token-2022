import { Account, generateKeyPairSigner, some } from '@solana/kit';
import test from 'ava';
import {
  AccountState,
  Mint,
  extension,
  fetchMint,
  getUpdateDefaultAccountStateInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  createMint,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it updates the default state account on a mint account', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, freezeAuthority] = await Promise.all([
    generateKeyPairSignerWithSol(client),
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

  // When we update the default account state on the mint account.
  await sendAndConfirmInstructions(client, authority, [
    getUpdateDefaultAccountStateInstruction({
      mint,
      freezeAuthority,
      state: AccountState.Initialized,
    }),
  ]);

  // Then we expect the mint account to have the following updated data.
  const mintAccount = await fetchMint(client.rpc, mint);
  t.like(mintAccount, <Account<Mint>>{
    address: mint,
    data: {
      extensions: some([
        extension('DefaultAccountState', { state: AccountState.Initialized }),
      ]),
    },
  });
});
