import { expect, it } from 'vitest';
import {
    Address,
    assertAccountExists,
    fetchEncodedAccount,
    generateKeyPairSigner,
    GetAccountInfoApi,
    Rpc,
} from '@solana/kit';
import { ExtensionType } from '../../src';
import { createTestClient, createToken, generateKeyPairSignerWithSol } from '../_setup';

it('reallocates token accounts to fit the provided extensions', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, owner, mint] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a token account with no extensions.
    await client.token2022.instructions
        .createMint({ payer: authority, newMint: mint, mintAuthority: authority })
        .sendTransaction();
    const token = await createToken({
        client,
        mint: mint.address,
        owner,
        payer: authority,
    });
    expect(await getAccountLength(client, token)).toBe(165);

    // When
    await client.token2022.instructions
        .reallocate({ token, owner, newExtensionTypes: [ExtensionType.MemoTransfer], payer: authority })
        .sendTransaction();

    // Then
    expect(await getAccountLength(client, token)).toBe(
        165 /** base token length */ +
            1 /** account type discriminator */ +
            2 /** memo transfer discriminator */ +
            2 /** memo transfer length */ +
            1 /** memo transfer boolean */,
    );
});

async function getAccountLength(client: { rpc: Rpc<GetAccountInfoApi> }, address: Address) {
    const account = await fetchEncodedAccount(client.rpc, address);
    assertAccountExists(account);
    return account.data.length;
}
