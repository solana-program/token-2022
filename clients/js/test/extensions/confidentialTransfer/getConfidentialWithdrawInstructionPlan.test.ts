import { expect, it } from 'vitest';
import { fetchToken } from '../../../src';
import { getConfidentialWithdrawInstructionPlan } from '../../../src/confidential';
import {
    createConfidentialMint,
    createConfidentialTokenAccountWithBalance,
    createValidatorClient,
    generateKeyPairSignerWithSol,
} from '../../_setup';

it('withdraws tokens from a confidential balance', async () => {
    // Given a confidential token account funded with an available confidential balance.
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

    // When we withdraw part of the confidential balance back to the public balance.
    const { data: tokenAccount } = await fetchToken(client.rpc, account.token);
    await client.sendTransactions(
        await getConfidentialWithdrawInstructionPlan({
            payer,
            rpc: client.rpc,
            token: account.token,
            mint,
            tokenAccount,
            authority: owner,
            amount: 400n,
            decimals,
            elgamalKeypair: account.elgamalKeypair,
            aesKey: account.aesKey,
        }),
    );

    // Then the withdrawn amount is reflected in the public token balance.
    const { data: updated } = await fetchToken(client.rpc, account.token);
    expect(updated.amount).toBe(400n);
});
