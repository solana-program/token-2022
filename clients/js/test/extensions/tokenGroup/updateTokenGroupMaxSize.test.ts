import { expect, it } from 'vitest';
import { generateKeyPairSigner, unwrapOption } from '@solana/kit';
import { extension, fetchMint, isExtension } from '../../../src';
import { createTestClient } from '../../_setup';

it('updates the max size of the token group extension', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, mint, updateAuthority] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a mint account initialized with the token group and group pointer extensions.
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            mintAuthority: authority,
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
        })
        .sendTransaction();

    // When we change the max size of the token group extension.
    await client.token2022.instructions
        .updateTokenGroupMaxSize({ group: mint.address, updateAuthority, maxSize: 30_000n })
        .sendTransaction();

    // Then we expect the token group extension to have the new max size.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    const tokenGroupExtension = unwrapOption(mintAccount.data.extensions)?.find(e => isExtension('TokenGroup', e));
    expect(tokenGroupExtension?.maxSize).toBe(30_000n);
});
