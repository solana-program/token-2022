import { expect, it } from 'vitest';

import { fetchMint, fetchToken } from '../../../src';
import {
    decryptConfidentialTransferBalance,
    getApplyConfidentialPendingBalanceInstructionFromToken,
    getConfidentialBurnWithRecordInstructionPlan,
    getConfidentialMintWithRecordInstructionPlan,
} from '../../../src/confidential';
import {
    createConfidentialMintBurnMint,
    createConfidentialTokenAccount,
    createValidatorClient,
    generateKeyPairSignerWithSol,
} from '../../_setup';

const DECIMALS = 2;
const MINT_AMOUNT = 500n;
const BURN_AMOUNT = 200n;

it('confidentially mints and burns with the range proof staged in a record account', async () => {
    // Given a client with the default resource-limit estimation, so the planner
    // reserves a provisory compute-unit-limit instruction on every transaction.
    // The inline mint/burn plans cannot fit one; the record-backed plans can.
    const client = await createValidatorClient();
    const payer = client.payer;
    const owner = await generateKeyPairSignerWithSol(client);
    const { mint, mintAuthority, supplyElgamalKeypair, supplyAesKey } = await createConfidentialMintBurnMint({
        client,
        payer,
        decimals: DECIMALS,
    });
    const account = await createConfidentialTokenAccount({ client, payer, owner, mint });

    // When the authority confidentially mints into the account's pending balance.
    const [{ data: destinationTokenAccount }, { data: mintAccount }] = await Promise.all([
        fetchToken(client.rpc, account.token),
        fetchMint(client.rpc, mint),
    ]);
    await client.sendTransactions(
        await getConfidentialMintWithRecordInstructionPlan({
            payer,
            rpc: client.rpc,
            token: account.token,
            mint,
            mintAccount,
            destinationTokenAccount,
            authority: mintAuthority,
            amount: MINT_AMOUNT,
            supplyElgamalKeypair,
            supplyAesKey,
        }),
    );

    // And the owner applies the pending balance so the minted amount is available.
    const { data: afterMint } = await fetchToken(client.rpc, account.token);
    await client.sendTransaction([
        getApplyConfidentialPendingBalanceInstructionFromToken({
            token: account.token,
            tokenAccount: afterMint,
            authority: owner,
            elgamalSecretKey: account.elgamalKeypair.secret(),
            aesKey: account.aesKey,
        }),
    ]);

    // Then the account's available balance decrypts to the minted amount.
    const { data: appliedAccount } = await fetchToken(client.rpc, account.token);
    expect(
        decryptConfidentialTransferBalance({
            tokenAccount: appliedAccount,
            elgamalSecretKey: account.elgamalKeypair.secret(),
            aesKey: account.aesKey,
        }).availableBalance,
    ).toBe(MINT_AMOUNT);

    // When the owner confidentially burns part of the available balance.
    const [{ data: sourceTokenAccount }, { data: mintForBurn }] = await Promise.all([
        fetchToken(client.rpc, account.token),
        fetchMint(client.rpc, mint),
    ]);
    await client.sendTransactions(
        await getConfidentialBurnWithRecordInstructionPlan({
            payer,
            rpc: client.rpc,
            token: account.token,
            mint,
            mintAccount: mintForBurn,
            sourceTokenAccount,
            authority: owner,
            amount: BURN_AMOUNT,
            sourceElgamalKeypair: account.elgamalKeypair,
            aesKey: account.aesKey,
        }),
    );

    // Then the available balance drops by the burnt amount.
    const { data: afterBurn } = await fetchToken(client.rpc, account.token);
    expect(
        decryptConfidentialTransferBalance({
            tokenAccount: afterBurn,
            elgamalSecretKey: account.elgamalKeypair.secret(),
            aesKey: account.aesKey,
        }).availableBalance,
    ).toBe(MINT_AMOUNT - BURN_AMOUNT);
});

it('reimburses a distinct record payer for the staged range-proof rent', async () => {
    // Given a separate signer that funds the record account, distinct from the fee payer.
    const client = await createValidatorClient();
    const payer = client.payer;
    const [owner, recordPayer] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSignerWithSol(client),
    ]);
    const { mint, mintAuthority, supplyElgamalKeypair, supplyAesKey } = await createConfidentialMintBurnMint({
        client,
        payer,
        decimals: DECIMALS,
    });
    const account = await createConfidentialTokenAccount({ client, payer, owner, mint });

    const recordPayerBalanceBefore = (await client.rpc.getBalance(recordPayer.address).send()).value;

    // When the mint stages its range proof in a record account funded by `recordPayer`.
    const [{ data: destinationTokenAccount }, { data: mintAccount }] = await Promise.all([
        fetchToken(client.rpc, account.token),
        fetchMint(client.rpc, mint),
    ]);
    await client.sendTransactions(
        await getConfidentialMintWithRecordInstructionPlan({
            payer,
            rpc: client.rpc,
            token: account.token,
            mint,
            mintAccount,
            destinationTokenAccount,
            authority: mintAuthority,
            amount: MINT_AMOUNT,
            supplyElgamalKeypair,
            supplyAesKey,
            recordPayer,
        }),
    );

    // Then the record payer is fully reimbursed when the record account is closed: it
    // funds the rent on create and receives it back on close (defaulting to the record
    // payer), and it never pays transaction fees, so its balance is unchanged.
    const recordPayerBalanceAfter = (await client.rpc.getBalance(recordPayer.address).send()).value;
    expect(recordPayerBalanceAfter).toBe(recordPayerBalanceBefore);
});
