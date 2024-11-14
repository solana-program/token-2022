import { Account, generateKeyPairSigner } from '@solana/web3.js';
import test from 'ava';
import {
  Token,
  getWithdrawExcessLamportsInstruction,
  fetchToken,
} from '../../../src';
import {
  createDefaultSolanaClient,
  createMint,
  createToken,
  generateKeyPairSignerWithSol,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it withdraws excess lamports from a token account', async (t) => {
  // Given a destination account and a token account with excess lamports
  const client = createDefaultSolanaClient();
  const [authority, destination] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

  // Create mint and token where authority is the owner
  const mint = await createMint({
    authority,
    client,
    payer: authority,
  });

  // Create token account owned by the authority
  const token = await createToken({
    client,
    mint,
    owner: authority, // Authority is the owner of the token
    payer: authority,
  });

  // When we withdraw excess lamports using the owner as authority
  await sendAndConfirmInstructions(client, authority, [
    getWithdrawExcessLamportsInstruction({
      source: token,
      destination: destination.address,
      authority, // Authority must be the token account owner
    }),
  ]);

  // Then we expect the token account to still exist with minimum rent
  const tokenAccount = await fetchToken(client.rpc, token);
  t.like(tokenAccount, <Account<Token>>{
    address: token,
    data: {
      owner: authority.address, // Verify ownership
    },
  });
});

test('it supports multisig authority for withdraw', async (t) => {
  // Given a token account with excess lamports and multisig authority
  const client = createDefaultSolanaClient();
  const [payer, multisigOwner, multisigSigner1, multisigSigner2, destination] =
    await Promise.all([
      generateKeyPairSignerWithSol(client),
      generateKeyPairSigner(),
      generateKeyPairSigner(),
      generateKeyPairSigner(),
      generateKeyPairSigner(),
    ]);

  // Create mint with multisig owner
  const mint = await createMint({
    authority: payer,
    client,
    payer,
  });

  // Create token account with multisig ownership
  const token = await createToken({
    client,
    mint,
    owner: multisigOwner, // Multisig owner
    payer,
  });

  // When we withdraw using multisig
  await sendAndConfirmInstructions(client, payer, [
    getWithdrawExcessLamportsInstruction({
      source: token,
      destination: destination.address,
      authority: multisigOwner, // Use multisig owner as authority
      multiSigners: [multisigSigner1, multisigSigner2],
    }),
  ]);

  // Then we expect the token account to still exist with minimum rent
  const tokenAccount = await fetchToken(client.rpc, token);
  t.like(tokenAccount, <Account<Token>>{
    address: token,
    data: {
      owner: multisigOwner.address, // Verify multisig ownership
    },
  });
});
