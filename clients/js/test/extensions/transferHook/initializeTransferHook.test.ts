import { Account, address, generateKeyPairSigner, some } from '@solana/kit';
import { expect, it } from 'vitest';

import { Mint, extension, fetchMint } from '../../../src';
import { createTestClient } from '../../_setup';

it('initializes a mint with transfer hook extension', async () => {
    // Given some signer accounts
    const client = await createTestClient();
    const [authority, mint] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);

    // And a transfer hook extension
    const transferHookAuthority = address('6sPR6MzvjMMP5LSZzEtTe4ZBVX9rhBmtM1dmfFtkNTbW');
    const transferHookProgramId = address('BTNEPmmWuj7Sg4Fo5i1FC5eiV2Aj4jiv9boarvE5XeaX');
    const transferHookExtension = extension('TransferHook', {
        authority: transferHookAuthority,
        programId: transferHookProgramId,
    });

    // When we create and initialize a mint account with this extension
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            mintAuthority: authority,
            extensions: [transferHookExtension],
        })
        .sendTransaction();

    // Then we expect the mint account to exist with the transfer hook extension
    const mintAccount = await fetchMint(client.rpc, mint.address);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
        data: {
            mintAuthority: some(authority.address),
            isInitialized: true,
            extensions: some([transferHookExtension]),
        },
    });
});
