import { Account, address, generateKeyPairSigner, some } from '@solana/kit';
import test from 'ava';
import {
  Mint,
  extension,
  fetchMint,
  getInitializeConfidentialTransferFeeInstruction,
  getInitializeTransferFeeConfigInstruction,
  getInitializeConfidentialTransferMintInstruction,
} from '../../../src';
import {
  createDefaultSolanaClient,
  generateKeyPairSignerWithSol,
  getCreateMintInstructions,
  sendAndConfirmInstructions,
} from '../../_setup';

test('it initializes a mint with confidential transfer fee', async (t) => {
  // Given an authority and a mint account.
  const client = createDefaultSolanaClient();
  const [authority, mint] = await Promise.all([
    generateKeyPairSignerWithSol(client),
    generateKeyPairSigner(),
  ]);

  // And required extensions configuration
  const confidentialTransferAuthority = address(
    '6sPR6MzvjMMP5LSZzEtTe4ZBVX9rhBmtM1dmfFtkNTbW'
  );
  const elgamalPubkey = address('BTNEPmmWuj7Sg4Fo5i1FC5eiV2Aj4jiv9boarvE5XeaX');

  // TransferFeeConfig extension
  const transferFeeConfigExtension = extension('TransferFeeConfig', {
    transferFeeConfigAuthority: confidentialTransferAuthority,
    withdrawWithheldAuthority: confidentialTransferAuthority,
    withheldAmount: 0n,
    olderTransferFee: {
      epoch: 0n,
      maximumFee: 0n,
      transferFeeBasisPoints: 0,
    },
    newerTransferFee: {
      epoch: 0n,
      maximumFee: 0n,
      transferFeeBasisPoints: 0,
    },
  });

  // ConfidentialTransferMint extension
  const confidentialTransferMintExtension = extension(
    'ConfidentialTransferMint',
    {
      authority: some(confidentialTransferAuthority),
      autoApproveNewAccounts: true,
      auditorElgamalPubkey: some(elgamalPubkey),
    }
  );

  // ConfidentialTransferFee extension
  const confidentialTransferFeeExtension = extension(
    'ConfidentialTransferFee',
    {
      authority: some(confidentialTransferAuthority),
      elgamalPubkey,
      harvestToMintEnabled: true,
      withheldAmount: new Uint8Array(64).fill(0),
    }
  );

  // When we create and initialize a mint account with these extensions.
  const [createMintInstruction, initMintInstruction] =
    await getCreateMintInstructions({
      authority: authority.address,
      client,
      decimals: 2,
      extensions: [
        transferFeeConfigExtension,
        confidentialTransferMintExtension,
        confidentialTransferFeeExtension,
      ],
      mint,
      payer: authority,
    });

  await sendAndConfirmInstructions(client, authority, [
    createMintInstruction,
    // Initialize TransferFeeConfig first
    getInitializeTransferFeeConfigInstruction({
      mint: mint.address,
      transferFeeConfigAuthority: confidentialTransferAuthority,
      withdrawWithheldAuthority: confidentialTransferAuthority,
      transferFeeBasisPoints: 0,
      maximumFee: 0n,
    }),
    // Then initialize ConfidentialTransferMint
    getInitializeConfidentialTransferMintInstruction({
      mint: mint.address,
      authority: some(confidentialTransferAuthority),
      autoApproveNewAccounts: true,
      auditorElgamalPubkey: some(elgamalPubkey),
    }),
    // Finally initialize ConfidentialTransferFee
    getInitializeConfidentialTransferFeeInstruction({
      mint: mint.address,
      authority: some(confidentialTransferAuthority),
      withdrawWithheldAuthorityElGamalPubkey: some(elgamalPubkey),
    }),
    initMintInstruction,
  ]);

  // Then we expect the mint account to exist and have all extensions.
  const mintAccount = await fetchMint(client.rpc, mint.address);
  t.like(mintAccount, <Account<Mint>>{
    address: mint.address,
    data: {
      mintAuthority: some(authority.address),
      decimals: 2,
      isInitialized: true,
      extensions: some([
        transferFeeConfigExtension,
        confidentialTransferMintExtension,
        confidentialTransferFeeExtension,
      ]),
    },
  });
});
