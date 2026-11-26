import { expect, it } from 'vitest';

import { fetchToken } from '../../../src';
import {
    decryptConfidentialTransferBalance,
    getConfidentialWithdrawInstructionPlan,
    getEmptyConfidentialTransferAccountInstructionPlan,
} from '../../../src/confidential';
import {
    createConfidentialMint,
    createConfidentialTokenAccountWithBalance,
    createValidatorClient,
    generateKeyPairSignerWithSol,
    getTokenExtension,
} from '../../_setup';

it('empties a zero confidential available balance for account closing', async () => {
    // Given a confidential token account whose confidential balance was fully withdrawn.
    const client = await createValidatorClient();
    const payer = client.payer;
    const owner = await generateKeyPairSignerWithSol(client);
    const { mint, mintAuthority } = await createConfidentialMint({ client, payer });
    const decimals = 2;
    const account = await createConfidentialTokenAccountWithBalance({
        client,
        payer,
        owner,
        mint,
        mintAuthority,
        decimals,
        amount: 1000n,
    });
    const { data: fundedTokenAccount } = await fetchToken(client.rpc, account.token);
    await client.sendTransactions(
        await getConfidentialWithdrawInstructionPlan({
            payer,
            rpc: client.rpc,
            token: account.token,
            mint,
            tokenAccount: fundedTokenAccount,
            authority: owner,
            amount: 1000n,
            decimals,
            elgamalKeypair: account.elgamalKeypair,
            aesKey: account.aesKey,
        }),
    );

    // When the confidential account is emptied.
    const { data: withdrawnTokenAccount } = await fetchToken(client.rpc, account.token);
    expect(
        decryptConfidentialTransferBalance({
            tokenAccount: withdrawnTokenAccount,
            elgamalSecretKey: account.elgamalKeypair.secret(),
            aesKey: account.aesKey,
        }).availableBalance,
    ).toBe(0n);
    await client.sendTransactions(
        await getEmptyConfidentialTransferAccountInstructionPlan({
            payer,
            rpc: client.rpc,
            token: account.token,
            tokenAccount: withdrawnTokenAccount,
            authority: owner,
            elgamalKeypair: account.elgamalKeypair,
        }),
    );

    // Then the available-balance ciphertext is reset to its all-zero closable state.
    const { data: emptiedTokenAccount } = await fetchToken(client.rpc, account.token);
    const confidentialAccount = getTokenExtension(emptiedTokenAccount, 'ConfidentialTransferAccount');
    expect(confidentialAccount.availableBalance).toEqual(new Uint8Array(64).fill(0));
});
