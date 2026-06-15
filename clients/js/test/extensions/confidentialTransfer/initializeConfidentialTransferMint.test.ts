import { Account, address, generateKeyPairSigner, some } from '@solana/kit';
import { expect, it } from 'vitest';

import { Mint, extension, fetchMint } from '../../../src';
import { createTestClient } from '../../_setup';

it('initializes a mint account with confidential transfer', async () => {
    // Given an authority and a mint account.
    const client = await createTestClient();
    const [authority, mint] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);

    // And a confidential transfer extension.
    const confidentialTransferExtension = extension('ConfidentialTransferMint', {
        authority: some(address('6sPR6MzvjMMP5LSZzEtTe4ZBVX9rhBmtM1dmfFtkNTbW')),
        autoApproveNewAccounts: true,
        auditorElgamalPubkey: some(address('BTNEPmmWuj7Sg4Fo5i1FC5eiV2Aj4jiv9boarvE5XeaX')),
    });

    // When we create and initialize a mint account with this extension.
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            mintAuthority: authority,
            extensions: [confidentialTransferExtension],
        })
        .sendTransaction();

    // Then we expect the mint account to exist and have the following data.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
        data: {
            mintAuthority: some(authority.address),
            isInitialized: true,
            extensions: some([confidentialTransferExtension]),
        },
    });
});
