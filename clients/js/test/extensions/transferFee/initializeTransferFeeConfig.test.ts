import {
  Account,
  address,
  generateKeyPairSigner,
  none,
  some,
} from '@solana/kit';
import test from 'ava';
import {
  Mint,
  extension,
  fetchMint,
  getInitializeTransferFeeConfigInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it initializes a mint account with transfer fee configurations', async (t) => {
  // Given an authority and a mint account.
  const client = createDefaultSolanaClient();
  const [authority, mint] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

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
  const [createMintInstruction, initMintInstruction] =
    await getCreateMintInstructions({
      authority: authority.address,
      client,
      decimals: 2,
      extensions: [transferFeeConfigExtension],
      mint,
      payer: authority,
    });
  await sendAndConfirmInstructions(client, authority, [
    createMintInstruction,
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
    initMintInstruction,
  ]);

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
      extensions: some([transferFeeConfigExtension]),
    },
  });
});
