import { expect, it } from 'vitest';
import { generateKeyPairSigner, none, some, unwrapOption } from '@solana/kit';
import { extension, fetchMint, isExtension } from '../../../src';
import { createTestClient } from '../../_setup';

it('updates the update authority of the token group extension', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, mint, updateAuthority, newUpdateAuthority] = await Promise.all([
        generateKeyPairSigner(),
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

    // When we change the update authority of the token group extension.
    await client.token2022.instructions
        .updateTokenGroupUpdateAuthority({
            group: mint.address,
            updateAuthority,
            newUpdateAuthority: newUpdateAuthority.address,
        })
        .sendTransaction();

    // Then we expect the new update authority to be set on the token group extension.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    const tokenGroupExtension = unwrapOption(mintAccount.data.extensions)?.find(e => isExtension('TokenGroup', e));
    expect(tokenGroupExtension?.updateAuthority).toEqual(some(newUpdateAuthority.address));
});

it('removes the update authority of the token group extension', async () => {
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

    // When we remove the update authority of the token group extension.
    await client.token2022.instructions
        .updateTokenGroupUpdateAuthority({ group: mint.address, updateAuthority, newUpdateAuthority: none() })
        .sendTransaction();

    // Then we expect the token group extension to have no update authority.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    const tokenGroupExtension = unwrapOption(mintAccount.data.extensions)?.find(e => isExtension('TokenGroup', e));
    expect(tokenGroupExtension?.updateAuthority).toEqual(none());
});
