import { Account, generateKeyPairSigner, some } from '@solana/web3.js';
import test from 'ava';
import {
  Mint,
  Token,
  extension,
  fetchMint,
  fetchToken,
  getInitializeNonTransferableMintInstruction,
  getTransferCheckedInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  createToken,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it initializes a mint as non-transferable', async (t) => {
  // Given an authority and a mint account.
  const client = createDefaultSolanaClient();
  const [authority, mint] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

  // And a non-transferable extension.
  const nonTransferableExtension = extension('NonTransferable', {});

  // When we create and initialize a mint account with this extension.
  const [createMintInstruction, initMintInstruction] = 
    await getCreateMintInstructions({
      authority: authority.address,
      client,
      extensions: [nonTransferableExtension],
      mint,
      payer: authority,
    });

  await sendAndConfirmInstructions(client, authority, [
    createMintInstruction,
    getInitializeNonTransferableMintInstruction({
      mint: mint.address,
    }),
    initMintInstruction,
  ]);

  // Then we expect the mint account to exist with non-transferable extension.
  const mintAccount = await fetchMint(client.rpc, mint.address);
  t.like(mintAccount, <Account<Mint>>{
    address: mint.address,
    data: {
      mintAuthority: some(authority.address),
      isInitialized: true,
      extensions: some([nonTransferableExtension]),
    },
  });

  // And when we create a token account for this mint
  const owner = generateKeyPairSigner();
  const token = await createToken({
    client,
    mint: mint.address,
    owner: owner.address,
    payer: authority,
  });

  // Then the token account should have the non-transferable extension
  const tokenAccount = await fetchToken(client.rpc, token);
  t.like(tokenAccount, <Account<Token>>{
    data: {
      extensions: some([extension('NonTransferableAccount', {})]),
    },
  });

  // And when we try to transfer tokens, it should fail
  const destination = await createToken({
    client,
    mint: mint.address,
    owner: generateKeyPairSigner().address,
    payer: authority,
  });

  await t.throwsAsync(async () => {
    await sendAndConfirmInstructions(client, owner, [
      getTransferCheckedInstruction({
        amount: 1n,
        decimals: 0,
        destination,
        mint: mint.address,
        owner: owner.address,
        source: token,
      }),
    ]);
  }, { message: /Non-transferable tokens cannot be transferred/ });
});