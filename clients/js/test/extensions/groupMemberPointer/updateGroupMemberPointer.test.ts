import { expect, it } from 'vitest';
import { Account, address, generateKeyPairSigner, some } from '@solana/kit';
import { Mint, extension, fetchMint } from '../../../src';
import { createTestClient } from '../../_setup';

it('updates the group member pointer extension on a mint account', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, groupMemberPointerAuthority, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const oldMember = address('8dtp4b6tB8EhLpSG1jgg4swSQtUKRst2f7rJYSwE2Me3');
    const newMember = address('88F35KbnWKPeMnKFJDxZVjvEWmGms1FxW6wP52VABCVt');

    // And a mint account initialized with a group member pointer extension.
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            mintAuthority: authority,
            extensions: [
                extension('GroupMemberPointer', {
                    authority: groupMemberPointerAuthority.address,
                    memberAddress: oldMember,
                }),
            ],
        })
        .sendTransaction();

    // When we update the group member pointer on the mint account.
    await client.token2022.instructions
        .updateGroupMemberPointer({ mint: mint.address, groupMemberPointerAuthority, memberAddress: newMember })
        .sendTransaction();

    // Then we expect the mint account to have the following updated data.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
        data: {
            extensions: some([
                extension('GroupMemberPointer', {
                    authority: some(groupMemberPointerAuthority.address),
                    memberAddress: some(newMember),
                }),
            ]),
        },
    });
});
