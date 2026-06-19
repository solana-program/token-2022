import { getAddressDecoder } from '@solana/kit';
import { ElGamalKeypair } from '@solana/zk-sdk/bundler';
import { expect, it } from 'vitest';

import { fetchToken } from '../../../src';
import { getConfidentialTransferInstructionPlan } from '../../../src/confidential';
import {
    createConfidentialMint,
    createConfidentialTokenAccount,
    createConfidentialTokenAccountWithBalance,
    createValidatorClient,
    fetchAssociatedToken,
    generateKeyPairSignerWithSol,
    getTokenExtension,
} from '../../_setup';

it('transfers tokens confidentially between two accounts', async () => {
    // Given a funded source account and an empty destination account.
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
    const [{ data: sourceTokenAccount }, { data: destinationTokenAccount }] = await Promise.all([
        fetchToken(client.rpc, source.token),
        fetchToken(client.rpc, destination.token),
    ]);
    await client.sendTransactions(
        await getConfidentialTransferInstructionPlan({
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

it('fetches the mint auditor ElGamal pubkey when omitted', async () => {
    // Given a confidential transfer mint configured with an auditor.
    const client = await createValidatorClient();
    const payer = client.payer;
    const [sourceOwner, destinationOwner] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSignerWithSol(client),
    ]);
    const auditorElgamalPubkey = getAddressDecoder().decode(new ElGamalKeypair().pubkey().toBytes());
    const { mint, mintAuthority } = await createConfidentialMint({
        client,
        payer,
        auditorElgamalPubkey,
    });
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

    // When the caller omits the auditor ElGamal pubkey.
    const [{ data: sourceTokenAccount }, { data: destinationTokenAccount }] = await Promise.all([
        fetchToken(client.rpc, source.token),
        fetchToken(client.rpc, destination.token),
    ]);
    await client.sendTransactions(
        await getConfidentialTransferInstructionPlan({
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

    // Then the helper found the auditor key on the mint and the transfer succeeded.
    const updatedDestination = await fetchAssociatedToken(client, destinationOwner.address, mint);
    const destinationConfidential = getTokenExtension(updatedDestination, 'ConfidentialTransferAccount');
    expect(destinationConfidential.pendingBalanceCreditCounter).toBe(1n);
});
