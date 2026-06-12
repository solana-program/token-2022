import { expect, it } from 'vitest';
import { generateKeyPairSigner, unwrapOption } from '@solana/kit';
import { extension, fetchMint, getUpdateTokenGroupMaxSizeInstruction, isExtension } from '../../../src';
import { createTestClient, createMint, generateKeyPairSignerWithSol } from '../../_setup';

it('updates the max size of the token group extension', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, mint, updateAuthority] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a mint account initialized with the token group and group pointer extensions.
    await createMint({
        authority,
        client,
        extensions: [
            extension('GroupPointer', {
                authority: authority.address,
                groupAddress: mint.address,
            }),
            extension('TokenGroup', {
                updateAuthority: updateAuthority.address,
                mint: mint.address,
                size: 0n,
                maxSize: 20_000n,
            }),
        ],
        mint,
        payer: authority,
    });

    // When we change the max size of the token group extension.
    await client.sendTransaction([
        getUpdateTokenGroupMaxSizeInstruction({
            group: mint.address,
            updateAuthority,
            maxSize: 30_000n,
        }),
    ]);

    // Then we expect the token group extension to have the new max size.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    const tokenGroupExtension = unwrapOption(mintAccount.data.extensions)?.find(e => isExtension('TokenGroup', e));
    expect(tokenGroupExtension?.maxSize).toBe(30_000n);
});
