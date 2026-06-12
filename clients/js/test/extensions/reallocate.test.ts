import { expect, it } from 'vitest';
import {
    Address,
    assertAccountExists,
    fetchEncodedAccount,
    generateKeyPairSigner,
    GetAccountInfoApi,
    Rpc,
} from '@solana/kit';
import { ExtensionType, getReallocateInstruction } from '../../src';
import { createTestClient, createMint, createToken, generateKeyPairSignerWithSol } from '../_setup';

it('reallocates token accounts to fit the provided extensions', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, owner] = await Promise.all([generateKeyPairSignerWithSol(client), generateKeyPairSigner()]);

    // And a token account with no extensions.
    const mint = await createMint({ authority, client, payer: authority });
    const token = await createToken({
        client,
        mint,
        owner,
        payer: authority,
    });
    expect(await getAccountLength(client, token)).toBe(165);

    // When
    await client.sendTransaction([
        getReallocateInstruction({
            token,
            owner,
            newExtensionTypes: [ExtensionType.MemoTransfer],
            payer: authority,
        }),
    ]);

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
