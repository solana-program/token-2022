import { getTransferSolInstruction } from '@solana-program/system';
import { generateKeyPairSigner } from '@solana/kit';
import { expect, it } from 'vitest';

import {
    AccountState,
    TOKEN_2022_PROGRAM_ADDRESS,
    fetchToken,
    findAssociatedTokenPda,
    getCreateAssociatedTokenInstructionAsync,
} from '../src';
import { createTestClient, createToken, generateKeyPairSignerWithSol } from './_setup';

it('withdraws excess lamports from an associated token account', async () => {
    // Given: A client, a payer, mint authority, token owner, and destination account
    const client = await createTestClient();
    const [payer, mintAuthority, owner, destination] = await Promise.all([
        generateKeyPairSignerWithSol(client, 200_000_000n),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a mint and token are created
    const mint = await generateKeyPairSigner();
    await client.token2022.instructions
        .createMint({ payer, newMint: mint, mintAuthority, decimals: 9 })
        .sendTransaction();
    const token = await createToken({ client, payer, mint: mint.address, owner });

    // And tokens are minted to the token account
    await client.token2022.instructions
        .mintTo({ mint: mint.address, token, mintAuthority, amount: 100_000n })
        .sendTransaction();

    // And an associated token account (ATA) is created for the owner
    const createAtaInstruction = await getCreateAssociatedTokenInstructionAsync({
        payer,
        mint: mint.address,
        owner: owner.address,
    });
    await client.sendTransaction([createAtaInstruction]);

    const [ata] = await findAssociatedTokenPda({
        mint: mint.address,
        owner: owner.address,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });

    // Ensure the token account was initialized correctly
    const initialTokenAccount = await fetchToken(client.rpc, ata);
    expect(initialTokenAccount.data.state).toBe(AccountState.Initialized);

    // When: SOL is mistakenly transferred to the ATA
    const transferSolInstruction = getTransferSolInstruction({
        source: payer,
        destination: ata,
        amount: 1_000_000n,
    });
    await client.sendTransaction([transferSolInstruction]);

    // Capture initial balances for comparison after withdrawal
    const lamportsBefore = await client.rpc.getBalance(destination.address).send();
    const ataLamportsBefore = await client.rpc.getBalance(ata).send();

    // And we initiate withdrawal of excess lamports from the ATA to the destination
    await client.token2022.instructions
        .withdrawExcessLamports({ source: ata, destination: destination.address, authority: owner })
        .sendTransaction();

    // Then: Verify that lamports were successfully withdrawn to the destination
    const lamportsAfter = await client.rpc.getBalance(destination.address).send();
    const ataLamportsAfter = await client.rpc.getBalance(ata).send();

    // Assertions to confirm successful transfer of lamports
    expect(
        Number(lamportsAfter.value) > Number(lamportsBefore.value),
        'Lamports were successfully withdrawn to the destination account.',
    ).toBe(true);
    expect(
        Number(ataLamportsBefore.value) > Number(ataLamportsAfter.value),
        'Lamports were successfully withdrawn from the ATA.',
    ).toBe(true);
});
