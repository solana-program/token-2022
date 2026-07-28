import { isSome } from '@solana/kit';
import { AeCiphertext } from '@solana/zk-sdk/bundler';
import { expect, it } from 'vitest';

import { Mint, fetchMint, fetchToken, getApplyConfidentialPendingBurnInstruction } from '../../../src';
import {
    decryptConfidentialTransferBalance,
    getApplyConfidentialPendingBalanceInstructionFromToken,
    getConfidentialMintInstructionPlan,
    getPermissionedConfidentialBurnInstructionPlan,
    getUpdateConfidentialMintBurnDecryptableSupplyInstructionFromSupply,
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

function getConfidentialMintBurnExtension(mint: Mint) {
    if (!isSome(mint.extensions)) {
        throw new Error('Mint account is missing extensions.');
    }
    const extension = mint.extensions.value.find(candidate => candidate.__kind === 'ConfidentialMintBurn');
    if (!extension || extension.__kind !== 'ConfidentialMintBurn') {
        throw new Error('Mint account is missing the ConfidentialMintBurn extension.');
    }
    return extension;
}

it('confidentially burns from a mint carrying the PermissionedBurn extension', async () => {
    // Given a mint-burn mint that ALSO carries the PermissionedBurn extension
    // (as tokenized-security mints do). token-2022 rejects the standard
    // confidential burn on such mints, so the permissioned variant is required.
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

    // When the owner confidentially burns part of the available balance via the
    // permissioned variant, co-signed by the mint's permissioned burn authority.
    const [{ data: sourceTokenAccount }, { data: mintForBurn }] = await Promise.all([
        fetchToken(client.rpc, account.token),
        fetchMint(client.rpc, mint),
    ]);
    await client.sendTransactions(
        await getPermissionedConfidentialBurnInstructionPlan({
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

    // Finally the authority applies the mint's pending burn and re-syncs the
    // decryptable supply.
    await client.sendTransaction([
        getApplyConfidentialPendingBurnInstruction({ mint, authority: mintAuthority }),
        getUpdateConfidentialMintBurnDecryptableSupplyInstructionFromSupply({
            mint,
            authority: mintAuthority,
            supplyAesKey,
            supply: MINT_AMOUNT - BURN_AMOUNT,
        }),
    ]);

    const { data: finalMint } = await fetchMint(client.rpc, mint);
    const mintBurnExtension = getConfidentialMintBurnExtension(finalMint);
    const decryptableSupplyCiphertext = AeCiphertext.fromBytes(new Uint8Array(mintBurnExtension.decryptableSupply));
    if (!decryptableSupplyCiphertext) {
        throw new Error('Failed to decode the decryptable supply ciphertext.');
    }
    expect(supplyAesKey.decrypt(decryptableSupplyCiphertext)).toBe(MINT_AMOUNT - BURN_AMOUNT);
});
