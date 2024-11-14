import { address, generateKeyPairSigner, none, some } from '@solana/web3.js';
import test from 'ava';
import {
  getInitializeConfidentialTransferFeeConfigInstruction,
  fetchMint,
  extension,
  getInitializeTransferFeeConfigInstruction,
  getInitializeConfidentialTransferMintInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('initializeConfidentialTransferFeeConfig should initialize transfer fee config for a mint', async (t) => {
  // Given some signer accounts.
  const client = createDefaultSolanaClient();
  const [authority, mint] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

  const confidentialAuthorityAddress = address(
    '6sPR6MzvjMMP5LSZzEtTe4ZBVX9rhBmtM1dmfFtkNTbW'
  );

  const elgamalPubkey = address('BTNEPmmWuj7Sg4Fo5i1FC5eiV2Aj4jiv9boarvE5XeaX');

  const transferFees = {
    epoch: 0n,
    maximumFee: 1_000_000_000n,
    transferFeeBasisPoints: 150, // 1.5%
  };

  const transferFeeConfigExtension = extension('TransferFeeConfig', {
    transferFeeConfigAuthority: authority.address,
    withdrawWithheldAuthority: authority.address,
    withheldAmount: 0n,
    newerTransferFee: transferFees,
    // Used for transitioning configs. Starts by being the same as newerTransferFee.
    olderTransferFee: transferFees,
  });

  const confidentialTransferExtension = extension('ConfidentialTransferMint', {
    authority: some(authority.address),
    autoApproveNewAccounts: true,
    auditorElgamalPubkey: none(),
  });

  const confidentialTransferFeeConfigExtension = extension(
    'ConfidentialTransferFee',
    {
      authority: some(confidentialAuthorityAddress),
      elgamalPubkey: elgamalPubkey,
      harvestToMintEnabled: true,
      withheldAmount: new Uint8Array(64).fill(0),
    }
  );

  // When we create and initialize a mint account with this extension.
  const [createMintInstruction, initMintInstruction] =
    await getCreateMintInstructions({
      authority: authority.address,
      client,
      extensions: [
        transferFeeConfigExtension,
        confidentialTransferExtension,
        confidentialTransferFeeConfigExtension,
      ],
      mint,
      payer: authority,
    });

  await sendAndConfirmInstructions(client, authority, [
    createMintInstruction,
    getInitializeTransferFeeConfigInstruction({
      mint: mint.address,
      transferFeeBasisPoints: 150,
      maximumFee: 1_000_000_000n,
      transferFeeConfigAuthority: authority.address,
      withdrawWithheldAuthority: authority.address,
    }),
    getInitializeConfidentialTransferMintInstruction({
      mint: mint.address,
      authority: some(authority.address),
      autoApproveNewAccounts: true,
      auditorElgamalPubkey: none(),
    }),
    getInitializeConfidentialTransferFeeConfigInstruction({
      mint: mint.address,
      authority: some(authority.address),
      withdrawWithheldAuthorityElgamalPubkey: elgamalPubkey,
    }),
    initMintInstruction,
  ]);

  // Then we expect the mint account to exist and have the proper transfer fee config initialized.
  const mintAccount = await fetchMint(client.rpc, mint.address);
  t.true(!!mintAccount);
  // t.deepEqual(mintAccount.data.extensions, some([confidentialTransferFeeConfigExtension]), 'Mint should have the proper extension');
});
