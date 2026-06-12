import { expect, it } from 'vitest';
import { Account, generateKeyPairSigner, some } from '@solana/kit';
import { Mint, extension, fetchMint } from '../../../src';
import { createTestClient } from '../../_setup';

it('initializes a mint with permissioned burn', async () => {
    // Given a fresh client and signers
    const client = await createTestClient();
    const [authority, mint, permissionedBurnAuthority] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a permissioned burn extension
    const permissionedBurnExtension = extension('PermissionedBurn', {
        authority: some(permissionedBurnAuthority.address),
    });

    // When we create and initialize a mint account with this extension
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            mintAuthority: authority,
            extensions: [permissionedBurnExtension],
        })
        .sendTransaction();

    // Then we expect the mint account to exist with the permissioned burn config
    const mintAccount = await fetchMint(client.rpc, mint.address);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
        data: {
            mintAuthority: some(authority.address),
            isInitialized: true,
            extensions: some([permissionedBurnExtension]),
        },
    });
});
