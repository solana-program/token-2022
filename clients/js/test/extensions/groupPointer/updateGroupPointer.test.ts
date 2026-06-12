import { expect, it } from 'vitest';
import { Account, address, generateKeyPairSigner, some } from '@solana/kit';
import { Mint, extension, fetchMint } from '../../../src';
import { createTestClient } from '../../_setup';

it('updates the group pointer extension on a mint account', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, groupPointerAuthority, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const oldGroup = address('8dtp4b6tB8EhLpSG1jgg4swSQtUKRst2f7rJYSwE2Me3');
    const newGroup = address('88F35KbnWKPeMnKFJDxZVjvEWmGms1FxW6wP52VABCVt');

    // And a mint account initialized with a group pointer extension.
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            mintAuthority: authority,
            extensions: [
                extension('GroupPointer', {
                    authority: groupPointerAuthority.address,
                    groupAddress: oldGroup,
                }),
            ],
        })
        .sendTransaction();

    // When we update the group pointer on the mint account.
    await client.token2022.instructions
        .updateGroupPointer({ mint: mint.address, groupPointerAuthority, groupAddress: newGroup })
        .sendTransaction();

    // Then we expect the mint account to have the following updated data.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
        data: {
            extensions: some([
                extension('GroupPointer', {
                    authority: some(groupPointerAuthority.address),
                    groupAddress: some(newGroup),
                }),
            ]),
        },
    });
});
