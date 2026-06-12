import { expect, it } from 'vitest';
import { Account, generateKeyPairSigner, some } from '@solana/kit';
import { Token, extension, fetchToken, getEnableMemoTransfersInstruction } from '../../../src';
import {
    createTestClient,
    createMint,
    createToken,
    generateKeyPairSignerWithSol,
    getCreateTokenInstructions,
} from '../../_setup';

it('initializes a token account with an active memo transfers extension', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, token, owner] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a mint account.
    const mint = await createMint({ authority, client, payer: authority });

    // When we create a token account and enable memo transfers.
    const memoTransfersExtension = extension('MemoTransfer', {
        requireIncomingTransferMemos: true,
    });
    const [createTokenInstruction, initTokenInstruction] = await getCreateTokenInstructions({
        client,
        extensions: [memoTransfersExtension],
        mint,
        owner: owner.address,
        payer: authority,
        token,
    });
    await client.sendTransaction([
        createTokenInstruction,
        initTokenInstruction,
        getEnableMemoTransfersInstruction({ token: token.address, owner }),
    ]);

    // Then we expect the token account to exist and have the following extension.
    const tokenAccount = await fetchToken(client.rpc, token.address);
    expect(tokenAccount).toMatchObject(<Account<Token>>{
        address: token.address,
        data: {
            extensions: some([memoTransfersExtension]),
        },
    });
});

it('enables an disabled memo transfers extension', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, owner] = await Promise.all([generateKeyPairSignerWithSol(client), generateKeyPairSigner()]);

    // And a token account with a disabled memo transfers extension.
    const mint = await createMint({ authority, client, payer: authority });
    const token = await createToken({
        client,
        extensions: [extension('MemoTransfer', { requireIncomingTransferMemos: false })],
        mint,
        owner,
        payer: authority,
    });

    // When we enable the memo transfers extension.
    await client.sendTransaction([getEnableMemoTransfersInstruction({ token, owner })]);

    // Then we expect the token account to have the extension enabled.
    const tokenAccount = await fetchToken(client.rpc, token);
    expect(tokenAccount.data.extensions).toEqual(
        some([extension('MemoTransfer', { requireIncomingTransferMemos: true })]),
    );
});
