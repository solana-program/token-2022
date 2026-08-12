import { expect, it } from 'vitest';

import { fetchMint, fetchToken, getApplyConfidentialPendingBurnInstruction } from '../../../src';
import {
    decryptConfidentialTransferBalance,
    getApplyConfidentialPendingBalanceInstructionFromToken,
    getConfidentialBurnInstructionPlan,
    getConfidentialMintInstructionPlan,
    getUpdateConfidentialMintBurnDecryptableSupplyInstructionFromSupply,
} from '../../../src/confidential';
import {
    createConfidentialMintBurnMint,
    createConfidentialTokenAccount,
    createValidatorClient,
    fetchDecryptableSupply,
    generateKeyPairSignerWithSol,
} from '../../_setup';

const DECIMALS = 2;
const MINT_AMOUNT = 500n;
const BURN_AMOUNT = 200n;

it('confidentially mints into, applies, burns from, and re-syncs the supply of a mint-burn mint', async () => {
    // Given a mint-burn mint (both ConfidentialTransferMint + ConfidentialMintBurn)
    // and a confidential token account for an owner.
    // The inline mint/burn plans send their batched range proof in the verify
    // instruction data, which leaves no room for a compute-unit-limit instruction.
    const client = await createValidatorClient({ estimateResourceLimits: false });
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
        await getConfidentialMintInstructionPlan({
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
        await getConfidentialBurnInstructionPlan({
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

    // Finally the authority applies the mint's pending burn and re-syncs the
    // decryptable supply (ApplyPendingBurn advances the encrypted supply but
    // cannot re-encrypt the AES decryptable supply).
    await client.sendTransaction([
        getApplyConfidentialPendingBurnInstruction({ mint, authority: mintAuthority }),
        getUpdateConfidentialMintBurnDecryptableSupplyInstructionFromSupply({
            mint,
            authority: mintAuthority,
            supplyAesKey,
            supply: MINT_AMOUNT - BURN_AMOUNT,
        }),
    ]);

    expect(await fetchDecryptableSupply({ client, mint, supplyAesKey })).toBe(MINT_AMOUNT - BURN_AMOUNT);
});
