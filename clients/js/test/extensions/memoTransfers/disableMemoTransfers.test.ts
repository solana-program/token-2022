import { expect, it } from 'vitest';
import { Account, generateKeyPairSigner, some } from '@solana/kit';
import { Token, extension, fetchToken } from '../../../src';
import { createTestClient, createToken } from '../../_setup';

it('initializes a token account with a disabled memo transfers extension', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, token, owner, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a mint account.
    await client.token2022.instructions.createMint({ newMint: mint, mintAuthority: authority }).sendTransaction();

    // When we create a token account and disable memo transfers.
    const memoTransfersExtension = extension('MemoTransfer', {
        requireIncomingTransferMemos: false,
    });
    await client.token2022.instructions
        .createToken({
            newToken: token,
            mint: mint.address,
            owner,
            extensions: [memoTransfersExtension],
        })
        .sendTransaction();

    // Then we expect the token account to exist and have the following extension.
    const tokenAccount = await fetchToken(client.rpc, token.address);
    expect(tokenAccount).toMatchObject(<Account<Token>>{
        address: token.address,
        data: {
            extensions: some([memoTransfersExtension]),
        },
    });
});

it('disables an active memo transfers extension', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, owner, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a token account with an active memo transfers extension.
    await client.token2022.instructions.createMint({ newMint: mint, mintAuthority: authority }).sendTransaction();
    const token = await createToken({
        client,
        extensions: [extension('MemoTransfer', { requireIncomingTransferMemos: true })],
        mint: mint.address,
        owner,
        payer: client.payer,
    });

    // When we disable the memo transfers extension.
    await client.token2022.instructions.disableMemoTransfers({ token, owner }).sendTransaction();

    // Then we expect the token account to have the extension disabled.
    const tokenAccount = await fetchToken(client.rpc, token);
    expect(tokenAccount.data.extensions).toEqual(
        some([extension('MemoTransfer', { requireIncomingTransferMemos: false })]),
    );
});
