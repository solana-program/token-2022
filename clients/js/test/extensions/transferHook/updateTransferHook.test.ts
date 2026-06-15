import { Account, address, generateKeyPairSigner, some } from '@solana/kit';
import { expect, it } from 'vitest';

import { Mint, extension, fetchMint } from '../../../src';
import { createTestClient } from '../../_setup';

it('updates transfer hook program ID on a mint', async () => {
    // Given some signer accounts and client
    const client = await createTestClient();
    const [authority, hookAuthority, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a mint with initial transfer hook configuration
    const oldProgramId = address('BTNEPmmWuj7Sg4Fo5i1FC5eiV2Aj4jiv9boarvE5XeaX');
    const transferHookExtension = extension('TransferHook', {
        authority: hookAuthority.address,
        programId: oldProgramId,
    });

    await client.token2022.instructions
        .createMint({ newMint: mint, mintAuthority: authority, extensions: [transferHookExtension] })
        .sendTransaction();

    // When we update the program ID
    const newProgramId = address('6sPR6MzvjMMP5LSZzEtTe4ZBVX9rhBmtM1dmfFtkNTbW');
    await client.token2022.instructions
        .updateTransferHook({ mint: mint.address, authority: hookAuthority, programId: some(newProgramId) })
        .sendTransaction();

    // Then we expect the mint to have the updated program ID
    const mintAccount = await fetchMint(client.rpc, mint.address);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
        data: {
            extensions: some([
                extension('TransferHook', {
                    authority: hookAuthority.address,
                    programId: newProgramId,
                }),
            ]),
        },
    });
});
