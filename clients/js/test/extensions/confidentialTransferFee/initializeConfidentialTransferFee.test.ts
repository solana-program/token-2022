import { expect, it } from 'vitest';
import { Account, address, generateKeyPairSigner, some } from '@solana/kit';
import { Mint, extension, fetchMint } from '../../../src';
import { createTestClient } from '../../_setup';

it('initializes a mint with confidential transfer fee', async () => {
    // Given an authority and a mint account.
    const client = await createTestClient();
    const [authority, mint] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);

    // And required extensions configuration
    const confidentialTransferAuthority = address('6sPR6MzvjMMP5LSZzEtTe4ZBVX9rhBmtM1dmfFtkNTbW');
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
    const confidentialTransferMintExtension = extension('ConfidentialTransferMint', {
        authority: some(confidentialTransferAuthority),
        autoApproveNewAccounts: true,
        auditorElgamalPubkey: some(elgamalPubkey),
    });

    // ConfidentialTransferFee extension
    const confidentialTransferFeeExtension = extension('ConfidentialTransferFee', {
        authority: some(confidentialTransferAuthority),
        elgamalPubkey,
        harvestToMintEnabled: true,
        withheldAmount: new Uint8Array(64).fill(0),
    });

    // When we create and initialize a mint account with these extensions.
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            decimals: 2,
            mintAuthority: authority,
            extensions: [
                transferFeeConfigExtension,
                confidentialTransferMintExtension,
                confidentialTransferFeeExtension,
            ],
        })
        .sendTransaction();

    // Then we expect the mint account to exist and have all extensions.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
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
