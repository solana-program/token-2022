import { getAddressDecoder } from '@solana/kit';
import { ElGamalKeypair } from '@solana/zk-sdk/bundler';
import { expect, it } from 'vitest';

import { fetchMint, fetchToken } from '../../../src';
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

function getElGamalPubkeyAddress() {
    // ElGamal public keys and Solana addresses share the same 32-byte layout,
    // so use the address decoder to thread this key through Address-typed
    // confidential transfer configuration fields.
    return getAddressDecoder().decode(new ElGamalKeypair().pubkey().toBytes());
}

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
    const auditorElgamalPubkey = getElGamalPubkeyAddress();
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

it('uses a provided mint account to resolve the auditor ElGamal pubkey', async () => {
    // Given a confidential transfer mint configured with an auditor.
    const client = await createValidatorClient();
    const payer = client.payer;
    const [sourceOwner, destinationOwner] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSignerWithSol(client),
    ]);
    const auditorElgamalPubkey = getElGamalPubkeyAddress();
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

    // When the caller supplies a decoded mint account.
    const [{ data: sourceTokenAccount }, { data: destinationTokenAccount }, { data: mintAccount }] = await Promise.all([
        fetchToken(client.rpc, source.token),
        fetchToken(client.rpc, destination.token),
        fetchMint(client.rpc, mint),
    ]);
    const rpcWithoutGetAccountInfo = new Proxy(client.rpc, {
        get(target, property, receiver) {
            if (property === 'getAccountInfo') {
                throw new Error('getAccountInfo should not be called when mintAccount is provided.');
            }
            return Reflect.get(target, property, receiver);
        },
    }) as typeof client.rpc;

    await client.sendTransactions(
        await getConfidentialTransferInstructionPlan({
            payer,
            rpc: rpcWithoutGetAccountInfo,
            sourceToken: source.token,
            mint,
            mintAccount,
            destinationToken: destination.token,
            sourceTokenAccount,
            destinationTokenAccount,
            authority: sourceOwner,
            amount: 600n,
            sourceElgamalKeypair: source.elgamalKeypair,
            aesKey: source.aesKey,
        }),
    );

    // Then the transfer succeeds without fetching the mint inside the helper.
    const updatedDestination = await fetchAssociatedToken(client, destinationOwner.address, mint);
    const destinationConfidential = getTokenExtension(updatedDestination, 'ConfidentialTransferAccount');
    expect(destinationConfidential.pendingBalanceCreditCounter).toBe(1n);
});
