import { Account, address, generateKeyPairSigner, some } from '@solana/kit';
import { expect, it } from 'vitest';

import { Mint, extension, fetchMint } from '../../../src';
import { createTestClient } from '../../_setup';

it('initializes a mint with permanent delegate', async () => {
    // Given some signer accounts
    const client = await createTestClient();
    const [authority, mint] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);

    // And a permanent delegate extension
    const permanentDelegate = address('6sPR6MzvjMMP5LSZzEtTe4ZBVX9rhBmtM1dmfFtkNTbW');
    const permanentDelegateExtension = extension('PermanentDelegate', {
        delegate: permanentDelegate,
    });

    // When we create and initialize a mint account with this extension
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            mintAuthority: authority,
            extensions: [permanentDelegateExtension],
        })
        .sendTransaction();

    // Then we expect the mint account to exist with the permanent delegate
    const mintAccount = await fetchMint(client.rpc, mint.address);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
        data: {
            mintAuthority: some(authority.address),
            isInitialized: true,
            extensions: some([permanentDelegateExtension]),
        },
    });
});
