import { expect, it } from 'vitest';

import { fetchToken } from '../../../src';
import { getConfidentialTransferWithRecordInstructionPlan } from '../../../src/confidential';
import {
    createConfidentialMint,
    createConfidentialTokenAccount,
    createConfidentialTokenAccountWithBalance,
    createValidatorClient,
    fetchAssociatedToken,
    generateKeyPairSignerWithSol,
    getTokenExtension,
} from '../../_setup';

it('transfers tokens confidentially with the range proof staged in a record account', async () => {
    // Given a client with the default resource-limit estimation, so the planner
    // reserves a provisory compute-unit-limit instruction on every transaction.
    const client = await createValidatorClient();
    const payer = client.payer;
    const [sourceOwner, destinationOwner] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSignerWithSol(client),
    ]);
    const { mint, mintAuthority } = await createConfidentialMint({ client, payer });
    const decimals = 2;
    const source = await createConfidentialTokenAccountWithBalance({
        client,
        payer,
        owner: sourceOwner,
        mint,
        mintAuthority,
        decimals,
        amount: 1000n,
    });
    const destination = await createConfidentialTokenAccount({ client, payer, owner: destinationOwner, mint });

    // When the source confidentially transfers part of its balance to the destination.
    // The record-backed range proof keeps the verify transaction small enough to also
    // carry the compute-unit-limit instruction the executor sets from its estimate.
    const [{ data: sourceTokenAccount }, { data: destinationTokenAccount }] = await Promise.all([
        fetchToken(client.rpc, source.token),
        fetchToken(client.rpc, destination.token),
    ]);
    await client.sendTransactions(
        await getConfidentialTransferWithRecordInstructionPlan({
            payer,
            rpc: client.rpc,
            sourceToken: source.token,
            mint,
            destinationToken: destination.token,
            sourceTokenAccount,
            destinationTokenAccount,
            authority: sourceOwner,
            amount: 600n,
            sourceElgamalKeypair: source.elgamalKeypair,
            aesKey: source.aesKey,
        }),
    );

    // Then the destination account received a confidential credit in its pending balance.
    const updatedDestination = await fetchAssociatedToken(client, destinationOwner.address, mint);
    const destinationConfidential = getTokenExtension(updatedDestination, 'ConfidentialTransferAccount');
    expect(destinationConfidential.pendingBalanceCreditCounter).toBe(1n);
});

it('reimburses a distinct record payer for the staged range-proof rent', async () => {
    // Given a separate signer that funds the record account, distinct from the fee payer.
    const client = await createValidatorClient();
    const payer = client.payer;
    const [sourceOwner, destinationOwner, recordPayer] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSignerWithSol(client),
        generateKeyPairSignerWithSol(client),
    ]);
    const { mint, mintAuthority } = await createConfidentialMint({ client, payer });
    const decimals = 2;
    const source = await createConfidentialTokenAccountWithBalance({
        client,
        payer,
        owner: sourceOwner,
        mint,
        mintAuthority,
        decimals,
        amount: 1000n,
    });
    const destination = await createConfidentialTokenAccount({ client, payer, owner: destinationOwner, mint });

    const recordPayerBalanceBefore = (await client.rpc.getBalance(recordPayer.address).send()).value;

    // When the transfer stages its range proof in a record account funded by `recordPayer`.
    const [{ data: sourceTokenAccount }, { data: destinationTokenAccount }] = await Promise.all([
        fetchToken(client.rpc, source.token),
        fetchToken(client.rpc, destination.token),
    ]);
    await client.sendTransactions(
        await getConfidentialTransferWithRecordInstructionPlan({
            payer,
            rpc: client.rpc,
            sourceToken: source.token,
            mint,
            destinationToken: destination.token,
            sourceTokenAccount,
            destinationTokenAccount,
            authority: sourceOwner,
            amount: 600n,
            sourceElgamalKeypair: source.elgamalKeypair,
            aesKey: source.aesKey,
            recordPayer,
        }),
    );

    // Then the record payer is fully reimbursed when the record account is closed: it
    // funds the rent on create and receives it back on close (defaulting to the record
    // payer), and it never pays transaction fees, so its balance is unchanged.
    const recordPayerBalanceAfter = (await client.rpc.getBalance(recordPayer.address).send()).value;
    expect(recordPayerBalanceAfter).toBe(recordPayerBalanceBefore);
});
