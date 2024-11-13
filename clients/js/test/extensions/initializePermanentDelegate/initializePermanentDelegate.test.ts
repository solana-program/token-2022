import { Account, address, generateKeyPairSigner, some } from '@solana/web3.js';
import test from 'ava';
import {
  Token,
  extension,
  fetchToken,
  getMintToInstruction,
  getTransferCheckedInstruction,
  getInitializePermanentDelegateInstruction
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateTokenInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it initializes a mint with a permanent delegate', async (t) => {
  // Given a client and some signer accounts.
  const client = createDefaultSolanaClient();
  const [payer, mintKeypair, permanentDelegate, owner, tokenKeypair] =
    await Promise.all([
      generateKeyPairSignerWithSol(client),
      generateKeyPairSigner(),
      generateKeyPairSigner(),
      generateKeyPairSigner(),
      generateKeyPairSigner(),
    ]);

  // When we create a mint with a permanent delegate extension.
//   const permanentDelegateExtension = extension('PermanentDelegate', {
//     delegate: address(permanentDelegate.address),
//   });

  // Initialize the mint with the permanent delegate
  await sendAndConfirmInstructions(client, payer, [
    getInitializePermanentDelegateInstruction({
      mint: mintKeypair.address,
      delegate: permanentDelegate.address,
    }),
  ]);

  // And create a token account with some tokens.
  const createTokenInstructions = await getCreateTokenInstructions({
    client,
    mint: mintKeypair.address,
    owner: owner.address,
    payer,
    token: tokenKeypair,
  });

  await sendAndConfirmInstructions(client, payer, createTokenInstructions);

  // Mint some tokens using the permanent delegate
  const mintAmount = 1000n;
  await sendAndConfirmInstructions(client, payer, [
    getMintToInstruction({
      mint: mintKeypair.address,
      token: tokenKeypair.address,
      mintAuthority: permanentDelegate,
      amount: mintAmount,
    }),
  ]);

  // Then we expect the token account to have the minted amount and the mint to have the permanent delegate configured.

  const tokenAccount = await fetchToken(client.rpc, tokenKeypair.address);
  t.like(tokenAccount, <Account<Token>>{
    address: tokenKeypair.address,
    data: {
      mint:mintKeypair.address,
      owner: owner.address,
      amount: 1000n,
      delegate: some(permanentDelegate.address),
      extensions: some([
        extension('PermanentDelegate', { delegate: permanentDelegate.address }),
      ]),
    },
  });

  // And the permanent delegate should be able to transfer tokens
  const destinationToken = await generateKeyPairSigner();
  const createDestTokenInstructions = await getCreateTokenInstructions({
    client,
    mint:mintKeypair.address,
    owner: owner.address,
    payer,
    token: destinationToken,
  });

  await sendAndConfirmInstructions(client, payer, [
    ...createDestTokenInstructions,
    getTransferCheckedInstruction({
      source: tokenKeypair.address,
      mint:mintKeypair.address,
      destination: destinationToken.address,
      authority: permanentDelegate, // Using permanent delegate as authority
      amount: 500n,
      decimals: 2,
    }),
  ]);

  // Verify the transfer was successful
  const updatedSourceAccount = await fetchToken(client.rpc, tokenKeypair.address);
  t.is(updatedSourceAccount.data.amount, 500n);
  const destinationAccount = await fetchToken(
    client.rpc,
    destinationToken.address
  );
  t.is(destinationAccount.data.amount, 500n);
});
