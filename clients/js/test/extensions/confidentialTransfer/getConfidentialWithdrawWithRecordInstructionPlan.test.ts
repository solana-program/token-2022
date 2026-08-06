import { expect, it } from 'vitest';

import { fetchToken } from '../../../src';
import { getConfidentialWithdrawWithRecordInstructionPlan } from '../../../src/confidential';
import {
    createConfidentialMint,
    createConfidentialTokenAccountWithBalance,
    createValidatorClient,
    generateKeyPairSignerWithSol,
} from '../../_setup';

it('withdraws tokens from a confidential balance with the range proof staged in a record account', async () => {
    // Given a client with the default resource-limit estimation, so the planner
    // reserves a provisory compute-unit-limit instruction on every transaction.
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
    // The record-backed range proof keeps the verify transaction small enough to also
    // carry the compute-unit-limit instruction the executor sets from its estimate.
    const { data: tokenAccount } = await fetchToken(client.rpc, account.token);
    await client.sendTransactions(
        await getConfidentialWithdrawWithRecordInstructionPlan({
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
