import { Account, generateKeyPairSigner, some } from '@solana/kit';
import { expect, it } from 'vitest';

import { Mint, extension, fetchMint } from '../../../src';
import { createTestClient } from '../../_setup';

it('initializes a mint account with a group member pointer extension', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, mint, groupMember, groupMemberPointerAuthority] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a group member pointer extension.
    const groupMemberPointerExtension = extension('GroupMemberPointer', {
        authority: some(groupMemberPointerAuthority.address),
        memberAddress: some(groupMember.address),
    });

    // When we create and initialize a mint account with this extension.
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            mintAuthority: authority,
            extensions: [groupMemberPointerExtension],
        })
        .sendTransaction();

    // Then we expect the mint account to exist and have the following extension.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
        data: {
            extensions: some([groupMemberPointerExtension]),
        },
    });
});
