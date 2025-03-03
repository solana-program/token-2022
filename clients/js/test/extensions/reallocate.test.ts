import {
  Address,
  assertAccountExists,
  fetchEncodedAccount,
  generateKeyPairSigner,
  GetAccountInfoApi,
  Rpc,
} from '@solana/kit';
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
  const mint = await createMint({ authority, client, payer: authority });
  const token = await createToken({
    client,
    mint,
    owner,
    payer: authority,
  });
  t.is(await getAccountLength(client, token), 165);

  // When
  await sendAndConfirmInstructions(client, authority, [
    getReallocateInstruction({
      token,
      owner,
      newExtensionTypes: [ExtensionType.MemoTransfer],
      payer: authority,
    }),
  ]);

  // Then
  t.is(
    await getAccountLength(client, token),
    165 /** base token length */ +
      1 /** account type discriminator */ +
      2 /** memo transfer discriminator */ +
      2 /** memo transfer length */ +
      1 /** memo transfer boolean */
  );
});

async function getAccountLength(
  client: { rpc: Rpc<GetAccountInfoApi> },
  address: Address
) {
  const account = await fetchEncodedAccount(client.rpc, address);
  assertAccountExists(account);
  return account.data.length;
}
