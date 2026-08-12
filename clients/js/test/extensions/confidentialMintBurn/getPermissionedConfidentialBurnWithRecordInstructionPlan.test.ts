import { expect, it } from 'vitest';

import { fetchMint, fetchToken } from '../../../src';
import {
    decryptConfidentialTransferBalance,
    getApplyConfidentialPendingBalanceInstructionFromToken,
    getConfidentialMintWithRecordInstructionPlan,
    getPermissionedConfidentialBurnWithRecordInstructionPlan,
} from '../../../src/confidential';
import {
    createConfidentialMintBurnMint,
    createConfidentialTokenAccount,
    createMultisig,
    createValidatorClient,
    generateKeyPairSignerWithSol,
} from '../../_setup';

const DECIMALS = 2;
const MINT_AMOUNT = 500n;
const BURN_AMOUNT = 200n;

it('confidentially burns from a PermissionedBurn mint with the range proof staged in a record account', async () => {
    // Given a mint-burn + PermissionedBurn mint and a client with the default
    // resource-limit estimation, so the planner reserves a provisory
    // compute-unit-limit instruction that only the record-backed plan leaves room for.
    const client = await createValidatorClient();
    const payer = client.payer;
    const owner = await generateKeyPairSignerWithSol(client);
    const permissionedBurnAuthority = await generateKeyPairSignerWithSol(client);
    const { mint, mintAuthority, supplyElgamalKeypair, supplyAesKey } = await createConfidentialMintBurnMint({
        client,
        payer,
        decimals: DECIMALS,
        permissionedBurnAuthority,
    });
    const account = await createConfidentialTokenAccount({ client, payer, owner, mint });

    // When the authority confidentially mints into the account and the owner applies
    // the pending balance.
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

    // And the owner burns part of the available balance via the permissioned variant,
    // co-signed by the mint's permissioned burn authority.
    const [{ data: sourceTokenAccount }, { data: mintForBurn }] = await Promise.all([
        fetchToken(client.rpc, account.token),
        fetchMint(client.rpc, mint),
    ]);
    await client.sendTransactions(
        await getPermissionedConfidentialBurnWithRecordInstructionPlan({
            payer,
            rpc: client.rpc,
            token: account.token,
            mint,
            mintAccount: mintForBurn,
            sourceTokenAccount,
            authority: owner,
            permissionedBurnAuthority,
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

it('confidentially burns from a multisig-owned account with the range proof staged in a record account', async () => {
    // Given a mint-burn + PermissionedBurn mint and a confidential token account
    // owned by a 2-of-2 multisig, so the burn's `authority` is the multisig
    // address and both members must be passed as `multiSigners`.
    const client = await createValidatorClient();
    const payer = client.payer;
    const permissionedBurnAuthority = await generateKeyPairSignerWithSol(client);
    const [signerA, signerB] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSignerWithSol(client),
    ]);
    const multiSigners = [signerA, signerB];
    const { mint, mintAuthority, supplyElgamalKeypair, supplyAesKey } = await createConfidentialMintBurnMint({
        client,
        payer,
        decimals: DECIMALS,
        permissionedBurnAuthority,
    });
    const multisig = await createMultisig({ client, payer, signers: multiSigners });
    const account = await createConfidentialTokenAccount({
        client,
        payer,
        owner: multisig,
        mint,
        multiSigners,
    });

    // When the mint authority confidentially mints into the multisig-owned account
    // and the multisig members apply the pending balance.
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

    const { data: afterMint } = await fetchToken(client.rpc, account.token);
    await client.sendTransaction([
        getApplyConfidentialPendingBalanceInstructionFromToken({
            token: account.token,
            tokenAccount: afterMint,
            authority: multisig,
            multiSigners,
            elgamalSecretKey: account.elgamalKeypair.secret(),
            aesKey: account.aesKey,
        }),
    ]);

    // And the multisig members burn part of the available balance, co-signed by
    // the mint's permissioned burn authority.
    const [{ data: sourceTokenAccount }, { data: mintForBurn }] = await Promise.all([
        fetchToken(client.rpc, account.token),
        fetchMint(client.rpc, mint),
    ]);
    await client.sendTransactions(
        await getPermissionedConfidentialBurnWithRecordInstructionPlan({
            payer,
            rpc: client.rpc,
            token: account.token,
            mint,
            mintAccount: mintForBurn,
            sourceTokenAccount,
            authority: multisig,
            multiSigners,
            permissionedBurnAuthority,
            amount: BURN_AMOUNT,
            sourceElgamalKeypair: account.elgamalKeypair,
            aesKey: account.aesKey,
        }),
    );

    // Then the available balance drops by the burnt amount — which only holds if
    // the plan forwarded `multiSigners` to the permissioned burn instruction.
    const { data: afterBurn } = await fetchToken(client.rpc, account.token);
    expect(
        decryptConfidentialTransferBalance({
            tokenAccount: afterBurn,
            elgamalSecretKey: account.elgamalKeypair.secret(),
            aesKey: account.aesKey,
        }).availableBalance,
    ).toBe(MINT_AMOUNT - BURN_AMOUNT);
});
