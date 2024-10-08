import {
  Address,
  assertAccountExists,
  fetchEncodedAccount,
  generateKeyPairSigner,
  GetAccountInfoApi,
  Rpc,
} from '@solana/web3.js';
import test from 'ava';
import {
  AccountState,
  ExtensionType,
  extension,
  getReallocateInstruction,
} from '../../src';
import {
  createDefaultSolanaClient,
  createMint,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from '../_setup';

test('it reallocates mint accounts to fit the provided extensions', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, freezeAuthority] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

  // And a mint account initialized with a default account state extension.
  const mint = await createMint({
    authority: authority.address,
    client,
    extensions: [
      extension('DefaultAccountState', { state: AccountState.Frozen }),
    ],
    freezeAuthority: freezeAuthority.address,
    payer: authority,
  });
  t.is(await getAccountLength(client, mint), 171);

  // When
  await sendAndConfirmInstructions(client, authority, [
    getReallocateInstruction({
      account: mint,
      authority,
      newExtensionTypes: [ExtensionType.TransferFeeConfig],
      payer: authority,
    }),
  ]);

  // Then
  t.is(await getAccountLength(client, mint), 0);
});

async function getAccountLength(
  client: { rpc: Rpc<GetAccountInfoApi> },
  address: Address
) {
  const account = await fetchEncodedAccount(client.rpc, address);
  assertAccountExists(account);
  return account.data.length;
}
