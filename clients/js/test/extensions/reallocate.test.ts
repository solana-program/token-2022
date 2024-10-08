import {
  Address,
  assertAccountExists,
  fetchEncodedAccount,
  generateKeyPairSigner,
  GetAccountInfoApi,
  Rpc,
} from '@solana/web3.js';
import test from 'ava';
import { ExtensionType, getReallocateInstruction } from '../../src';
import {
  createDefaultSolanaClient,
  createMint,
  createToken,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from '../_setup';

test('it reallocates token accounts to fit the provided extensions', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, owner] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

  // And a token account with no extensions.
  const mint = await createMint({
    authority: authority.address,
    client,
    payer: authority,
  });
  const token = await createToken({
    client,
    mint,
    owner: owner.address,
    payer: authority,
  });
  t.is(await getAccountLength(client, token), 165);

  // When
  await sendAndConfirmInstructions(client, authority, [
    getReallocateInstruction({
      token,
      authority: owner,
      newExtensionTypes: [ExtensionType.MemoTransfer],
      payer: authority,
    }),
  ]);

  // Then
  t.is(await getAccountLength(client, token), 9999);
});

async function getAccountLength(
  client: { rpc: Rpc<GetAccountInfoApi> },
  address: Address
) {
  const account = await fetchEncodedAccount(client.rpc, address);
  assertAccountExists(account);
  return account.data.length;
}
