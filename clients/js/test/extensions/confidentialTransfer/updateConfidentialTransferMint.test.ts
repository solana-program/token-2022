import { expect, it } from 'vitest';
import { Account, address, generateKeyPairSigner, none, some } from '@solana/kit';
import { Mint, extension, fetchMint } from '../../../src';
import { createTestClient } from '../../_setup';

it('updates a mint account with confidential transfer', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, confidentialTransferAuthority, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a mint account initialized with a confidential transfer extension.
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            mintAuthority: authority,
            extensions: [
                extension('ConfidentialTransferMint', {
                    authority: some(confidentialTransferAuthority.address),
                    autoApproveNewAccounts: true,
                    auditorElgamalPubkey: some(address('BTNEPmmWuj7Sg4Fo5i1FC5eiV2Aj4jiv9boarvE5XeaX')),
                }),
            ],
        })
        .sendTransaction();

    // When we update the mint account with new confidential transfer configs.
    await client.token2022.instructions
        .updateConfidentialTransferMint({
            mint: mint.address,
            authority: confidentialTransferAuthority,
            autoApproveNewAccounts: false,
            auditorElgamalPubkey: none(),
        })
        .sendTransaction();

    // Then we expect the mint account to have the following updated data.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
        data: {
            mintAuthority: some(authority.address),
            extensions: some([
                extension('ConfidentialTransferMint', {
                    authority: some(confidentialTransferAuthority.address),
                    autoApproveNewAccounts: false,
                    auditorElgamalPubkey: none(),
                }),
            ]),
        },
    });
});
