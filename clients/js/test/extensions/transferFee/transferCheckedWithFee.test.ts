import { Account, address, generateKeyPairSigner, some } from '@solana/kit';
import test from 'ava';
import {
  Token,
  extension,
  fetchToken,
  getMintToInstruction,
  getTransferCheckedWithFeeInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  createMint,
  generateKeyPairSignerWithSol,
  getCreateTokenInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it transfers tokens with pre-configured fees', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, ownerA, tokenA, ownerB, tokenB] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);

  // And a mint account initialized with transfer fee configurations.
  const transferFees = {
    epoch: 0n,
    maximumFee: 1_000_000_000n,
    transferFeeBasisPoints: 150, // 1.5%
  };
  const transferFeeConfigExtension = extension('TransferFeeConfig', {
    transferFeeConfigAuthority: address(
      '6sPR6MzvjMMP5LSZzEtTe4ZBVX9rhBmtM1dmfFtkNTbW'
    ),
    withdrawWithheldAuthority: address(
      'BTNEPmmWuj7Sg4Fo5i1FC5eiV2Aj4jiv9boarvE5XeaX'
    ),
    withheldAmount: 0n,
    newerTransferFee: transferFees,
    // Used for transitioning configs. Starts by being the same as newerTransferFee.
    olderTransferFee: transferFees,
  });
  const mint = await createMint({
    authority,
    client,
    decimals: 2,
    extensions: [transferFeeConfigExtension],
    payer: authority,
  });

  // And two token accounts with 10.00 and 0.00 tokens respectively.
  const transferFeeAmount = extension('TransferFeeAmount', {
    withheldAmount: 0n,
  });
  const createTokensInstructions = await Promise.all([
    getCreateTokenInstructions({
      client,
      extensions: [transferFeeAmount],
      mint,
      owner: ownerA.address,
      payer: authority,
      token: tokenA,
    }),
    getCreateTokenInstructions({
      client,
      extensions: [transferFeeAmount],
      mint,
      owner: ownerB.address,
      payer: authority,
      token: tokenB,
    }),
  ]);
  await sendAndConfirmInstructions(client, authority, [
    ...createTokensInstructions.flat(),
    getMintToInstruction({
      mint,
      token: tokenA.address,
      mintAuthority: authority,
      amount: 1000n,
    }),
  ]);

  // When we transfer 2.00 tokens from owner A to owner B with fees.
  await sendAndConfirmInstructions(client, authority, [
    getTransferCheckedWithFeeInstruction({
      source: tokenA.address,
      mint,
      destination: tokenB.address,
      authority: ownerA,
      amount: 200n,
      decimals: 2,
      fee: 3n, // 1.5% of 2.00 is 0.03.
    }),
  ]);

  // Then we expect token A to have 8.00 tokens and no fees withheld.
  const tokenAccountA = await fetchToken(client.rpc, tokenA.address);
  t.like(tokenAccountA, <Account<Token>>{
    address: tokenA.address,
    data: {
      mint,
      owner: ownerA.address,
      amount: 800n,
      extensions: some([
        extension('TransferFeeAmount', { withheldAmount: 0n }),
      ]),
    },
  });

  // And token B to have 1.97 tokens and 0.03 fees withheld.
  const tokenAccountB = await fetchToken(client.rpc, tokenB.address);
  t.like(tokenAccountB, <Account<Token>>{
    address: tokenB.address,
    data: {
      mint,
      owner: ownerB.address,
      amount: 197n,
      extensions: some([
        extension('TransferFeeAmount', { withheldAmount: 3n }),
      ]),
    },
  });
});
