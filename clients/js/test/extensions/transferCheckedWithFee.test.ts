import {
  Account,
  address,
  appendTransactionMessageInstruction,
  appendTransactionMessageInstructions,
  generateKeyPairSigner,
  pipe,
  some,
} from '@solana/web3.js';
import test from 'ava';
import {
  Token,
  extension,
  fetchToken,
  getInitializeAccountInstruction,
  getInitializeMintInstruction,
  getInitializeTransferFeeConfigInstruction,
  getMintSize,
  getMintToInstruction,
  getTokenSize,
  getTransferCheckedWithFeeInstruction,
} from '../../src';
import {
  createDefaultSolanaClient,
  createDefaultTransaction,
  generateKeyPairSignerWithSol,
  getCreateToken22AccountInstruction,
  signAndSendTransaction,
} from '../_setup';

test('it transfers tokens with pre-configured fees', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, mint, ownerA, tokenA, ownerB, tokenB] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
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
  const space = getMintSize([transferFeeConfigExtension]);
  const createMintInstructions = [
    await getCreateToken22AccountInstruction(client, authority, mint, space),
    getInitializeTransferFeeConfigInstruction({
      mint: mint.address,
      transferFeeConfigAuthority:
        transferFeeConfigExtension.transferFeeConfigAuthority,
      withdrawWithheldAuthority:
        transferFeeConfigExtension.withdrawWithheldAuthority,
      transferFeeBasisPoints: transferFees.transferFeeBasisPoints,
      maximumFee: transferFees.maximumFee,
    }),
    getInitializeMintInstruction({
      mint: mint.address,
      decimals: 2,
      mintAuthority: authority.address,
    }),
  ];
  await pipe(
    await createDefaultTransaction(client, authority),
    (tx) => appendTransactionMessageInstructions(createMintInstructions, tx),
    (tx) => signAndSendTransaction(client, tx)
  );

  // And two token accounts with 10.00 and 0.00 tokens respectively.
  const transferFeeAmount = extension('TransferFeeAmount', {
    withheldAmount: 0n,
  });
  const tokenSpace = getTokenSize([transferFeeAmount]);
  const createTokensInstructions = [
    await getCreateToken22AccountInstruction(
      client,
      authority,
      tokenA,
      tokenSpace
    ),
    getInitializeAccountInstruction({
      account: tokenA.address,
      mint: mint.address,
      owner: ownerA.address,
    }),
    getMintToInstruction({
      mint: mint.address,
      token: tokenA.address,
      mintAuthority: authority,
      amount: 1000n,
    }),
    await getCreateToken22AccountInstruction(
      client,
      authority,
      tokenB,
      tokenSpace
    ),
    getInitializeAccountInstruction({
      account: tokenB.address,
      mint: mint.address,
      owner: ownerB.address,
    }),
  ];
  await pipe(
    await createDefaultTransaction(client, authority),
    (tx) => appendTransactionMessageInstructions(createTokensInstructions, tx),
    (tx) => signAndSendTransaction(client, tx)
  );

  // When we transfer 2.00 tokens from owner A to owner B with fees.
  const transferInstruction = getTransferCheckedWithFeeInstruction({
    source: tokenA.address,
    mint: mint.address,
    destination: tokenB.address,
    authority: ownerA,
    amount: 200n,
    decimals: 2,
    fee: 3n, // 1.5% of 2.00 is 0.03.
  });
  await pipe(
    await createDefaultTransaction(client, authority),
    (tx) => appendTransactionMessageInstruction(transferInstruction, tx),
    (tx) => signAndSendTransaction(client, tx)
  );

  // Then we expect token A to have 8.00 tokens and no fees withheld.
  const tokenAccountA = await fetchToken(client.rpc, tokenA.address);
  t.like(tokenAccountA, <Account<Token>>{
    address: tokenA.address,
    data: {
      mint: mint.address,
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
      mint: mint.address,
      owner: ownerB.address,
      amount: 197n,
      extensions: some([
        extension('TransferFeeAmount', { withheldAmount: 3n }),
      ]),
    },
  });
});
