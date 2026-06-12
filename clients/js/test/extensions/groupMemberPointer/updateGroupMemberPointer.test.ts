import { expect, it } from 'vitest';
import { Account, address, generateKeyPairSigner, some } from '@solana/kit';
import { Mint, extension, fetchMint, getUpdateGroupMemberPointerInstruction } from '../../../src';
import { createTestClient, createMint, generateKeyPairSignerWithSol } from '../../_setup';

it('updates the group member pointer extension on a mint account', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, groupMemberPointerAuthority] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSigner(),
    ]);
    const oldMember = address('8dtp4b6tB8EhLpSG1jgg4swSQtUKRst2f7rJYSwE2Me3');
    const newMember = address('88F35KbnWKPeMnKFJDxZVjvEWmGms1FxW6wP52VABCVt');

    // And a mint account initialized with a group member pointer extension.
    const mint = await createMint({
        authority,
        client,
        extensions: [
            extension('GroupMemberPointer', {
                authority: groupMemberPointerAuthority.address,
                memberAddress: oldMember,
            }),
        ],
        payer: authority,
    });

    // When we update the group member pointer on the mint account.
    await client.sendTransaction([
        getUpdateGroupMemberPointerInstruction({
            mint,
            groupMemberPointerAuthority,
            memberAddress: newMember,
        }),
    ]);

    // Then we expect the mint account to have the following updated data.
    const mintAccount = await fetchMint(client.rpc, mint);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint,
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
