import {
  Account,
  address,
  appendTransactionMessageInstructions,
  generateKeyPairSigner,
  none,
  pipe,
  some,
} from '@solana/web3.js';
import test from 'ava';
import {
  Mint,
  extension,
  fetchMint,
  getInitializeMintInstruction,
  getInitializeTransferFeeConfigInstruction,
  getMintSize,
} from '../../src';
import {
  createDefaultSolanaClient,
  createDefaultTransaction,
  generateKeyPairSignerWithSol,
  getCreateToken22AccountInstruction,
  signAndSendTransaction,
} from '../_setup';

test('it initializes a mint account with transfer fee configurations', async (t) => {
  // Given an authority and a mint account.
  const client = createDefaultSolanaClient();
  const authority = await generateKeyPairSignerWithSol(client);
  const mint = await generateKeyPairSigner();

  // And a transfer fee config extension.
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

  // When we create and initialize a mint account with this extension.
  const space = BigInt(getMintSize([transferFeeConfigExtension]));
  const instructions = [
    await getCreateToken22AccountInstruction(client, authority, mint, space),
    getInitializeTransferFeeConfigInstruction({
      mint: mint.address,
      transferFeeConfigAuthority:
        transferFeeConfigExtension.transferFeeConfigAuthority,
      withdrawWithheldAuthority:
        transferFeeConfigExtension.withdrawWithheldAuthority,
      transferFeeBasisPoints:
        transferFeeConfigExtension.newerTransferFee.transferFeeBasisPoints,
      maximumFee: transferFeeConfigExtension.newerTransferFee.maximumFee,
    }),
    getInitializeMintInstruction({
      mint: mint.address,
      decimals: 2,
      mintAuthority: authority.address,
    }),
  ];
  await pipe(
    await createDefaultTransaction(client, authority),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
    (tx) => signAndSendTransaction(client, tx)
  );

  // Then we expect the mint account to exist and have the following data.
  const mintAccount = await fetchMint(client.rpc, mint.address);
  t.like(mintAccount, <Account<Mint>>{
    address: mint.address,
    data: {
      mintAuthority: some(authority.address),
      supply: 0n,
      decimals: 2,
      isInitialized: true,
      freezeAuthority: none(),
      extensions: some([
        {
          __kind: 'TransferFeeConfig',
          transferFeeConfigAuthority: address(
            '6sPR6MzvjMMP5LSZzEtTe4ZBVX9rhBmtM1dmfFtkNTbW'
          ),
          withdrawWithheldAuthority: address(
            'BTNEPmmWuj7Sg4Fo5i1FC5eiV2Aj4jiv9boarvE5XeaX'
          ),
          withheldAmount: 0n,
          newerTransferFee: transferFees,
          olderTransferFee: transferFees,
        },
      ]),
    },
  });
});
