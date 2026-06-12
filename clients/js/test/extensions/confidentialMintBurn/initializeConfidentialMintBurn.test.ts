import { expect, it } from 'vitest';
import { Account, address, generateKeyPairSigner, some } from '@solana/kit';
import {
    Mint,
    extension,
    fetchMint,
    getInitializeConfidentialMintBurnInstruction,
    getInitializeConfidentialTransferMintInstruction,
} from '../../../src';
import { createTestClient, generateKeyPairSignerWithSol, getCreateMintInstructions } from '../../_setup';

it('initializes a mint with confidential mint burn', async () => {
    // Given an authority and a mint account.
    const client = await createTestClient();
    const [authority, mint] = await Promise.all([generateKeyPairSignerWithSol(client), generateKeyPairSigner()]);

    // And a confidential transfer extension, which is required by the
    // confidential mint burn extension.
    const confidentialTransferAuthority = address('6sPR6MzvjMMP5LSZzEtTe4ZBVX9rhBmtM1dmfFtkNTbW');
    const auditorElgamalPubkey = address('BTNEPmmWuj7Sg4Fo5i1FC5eiV2Aj4jiv9boarvE5XeaX');
    const confidentialTransferMintExtension = extension('ConfidentialTransferMint', {
        authority: some(confidentialTransferAuthority),
        autoApproveNewAccounts: true,
        auditorElgamalPubkey: some(auditorElgamalPubkey),
    });

    // And a confidential mint burn extension.
    const supplyElgamalPubkey = address('BTNEPmmWuj7Sg4Fo5i1FC5eiV2Aj4jiv9boarvE5XeaX');
    const decryptableSupply = new Uint8Array(36).fill(0);
    const confidentialMintBurnExtension = extension('ConfidentialMintBurn', {
        // The confidential supply and pending burn are zero-initialized.
        confidentialSupply: new Uint8Array(64).fill(0),
        decryptableSupply,
        supplyElgamalPubkey,
        pendingBurn: new Uint8Array(64).fill(0),
    });

    // When we create and initialize a mint account with these extensions.
    const [createMintInstruction, initMintInstruction] = await getCreateMintInstructions({
        authority: authority.address,
        client,
        extensions: [confidentialTransferMintExtension, confidentialMintBurnExtension],
        mint,
        payer: authority,
    });

    await client.sendTransaction([
        createMintInstruction,
        getInitializeConfidentialTransferMintInstruction({
            mint: mint.address,
            authority: some(confidentialTransferAuthority),
            autoApproveNewAccounts: true,
            auditorElgamalPubkey: some(auditorElgamalPubkey),
        }),
        getInitializeConfidentialMintBurnInstruction({
            mint: mint.address,
            supplyElgamalPubkey,
            decryptableSupply,
        }),
        initMintInstruction,
    ]);

    // Then we expect the mint account to exist and have both extensions.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
        data: {
            mintAuthority: some(authority.address),
            isInitialized: true,
            extensions: some([confidentialTransferMintExtension, confidentialMintBurnExtension]),
        },
    });
});
