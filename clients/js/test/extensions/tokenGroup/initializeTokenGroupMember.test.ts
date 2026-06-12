import { expect, it } from 'vitest';
import { generateKeyPairSigner, none, some, unwrapOption } from '@solana/kit';
import { extension, fetchMint, isExtension, Mint } from '../../../src';
import { createTestClient } from '../../_setup';

it('adds members to the token group extension', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, group, member, groupUpdateAuthority] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a group mint account initialized with the token group and group pointer extensions.
    await client.token2022.instructions
        .createMint({
            newMint: group,
            mintAuthority: authority,
            extensions: [
                extension('GroupPointer', {
                    authority: authority.address,
                    groupAddress: group.address,
                }),
                extension('TokenGroup', {
                    updateAuthority: groupUpdateAuthority.address,
                    mint: group.address,
                    size: 0n,
                    maxSize: 20_000n,
                }),
            ],
        })
        .sendTransaction();

    // And a member mint account with the group member pointer and the token group member extensions.
    const memberExtensions = [
        extension('GroupMemberPointer', {
            authority: none(),
            memberAddress: some(member.address),
        }),
        extension('TokenGroupMember', {
            mint: member.address,
            group: group.address,
            memberNumber: 1n,
        }),
    ];
    await client.token2022.instructions
        .createMint({ newMint: member, mintAuthority: authority, extensions: memberExtensions })
        .sendTransaction();

    // When we initialize the member mint account as a member of the group mint account.
    await client.token2022.instructions
        .initializeTokenGroupMember({
            member: member.address,
            memberMint: member.address,
            memberMintAuthority: authority,
            group: group.address,
            groupUpdateAuthority,
        })
        .sendTransaction();

    // Then we expect the member mint account to have the following extensions
    const memberAccount = await fetchMint(client.rpc, member.address);
    expect(memberAccount.data).toMatchObject(<Mint>{
        extensions: some(memberExtensions),
    });

    // And we expect the size of the group mint account to be updated accordingly.
    const groupAccount = await fetchMint(client.rpc, group.address);
    const tokenGroupExtension = unwrapOption(groupAccount.data.extensions)?.find(e => isExtension('TokenGroup', e));
    expect(tokenGroupExtension?.size).toBe(1n);
});
