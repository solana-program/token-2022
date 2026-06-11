import { expect, it } from 'vitest';
import { fetchToken } from '../../../src';
import { getConfidentialTransferInstructionPlan } from '../../../src/confidential';
import {
    createConfidentialMint,
    createConfidentialTokenAccount,
    createConfidentialTokenAccountWithBalance,
    createDefaultSolanaClient,
    fetchAssociatedToken,
    generateKeyPairSignerWithSol,
    getTokenExtension,
    sendAndConfirmInstructionPlan,
} from '../../_setup';

it('transfers tokens confidentially between two accounts', async () => {
    // Given a funded source account and an empty destination account.
    const client = createDefaultSolanaClient();
    const [payer, sourceOwner, destinationOwner] = await Promise.all([
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

    // When the source confidentially transfers part of its balance to the destination.
    const [{ data: sourceTokenAccount }, { data: destinationTokenAccount }] = await Promise.all([
        fetchToken(client.rpc, source.token),
        fetchToken(client.rpc, destination.token),
    ]);
    await sendAndConfirmInstructionPlan(
        client,
        payer,
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
