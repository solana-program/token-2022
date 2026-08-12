import { expect, it } from 'vitest';

import { fetchMint, fetchToken, getApplyConfidentialPendingBurnInstruction } from '../../../src';
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
    createMultisig,
    createValidatorClient,
    fetchDecryptableSupply,
    generateKeyPairSignerWithSol,
} from '../../_setup';

const DECIMALS = 2;
const MINT_AMOUNT = 500n;
const BURN_AMOUNT = 200n;

it('confidentially burns from a mint carrying the PermissionedBurn extension', async () => {
    // Given a mint-burn mint that ALSO carries the PermissionedBurn extension
    // (as tokenized-security mints do). token-2022 rejects the standard
    // confidential burn on such mints, so the permissioned variant is required.
    //
    // The inline mint/burn plans send their batched range proof in the verify
    // instruction data, which leaves no room for a compute-unit-limit instruction.
    const client = await createValidatorClient({ estimateResourceLimits: false });
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

    expect(await fetchDecryptableSupply({ client, mint, supplyAesKey })).toBe(MINT_AMOUNT - BURN_AMOUNT);
});

it('confidentially burns from an account owned by a multisig via the permissioned variant', async () => {
    // Given a mint-burn + PermissionedBurn mint and a confidential token account
    // owned by a 2-of-2 multisig, so the burn's `authority` is the multisig
    // address and both members must be passed as `multiSigners`.
    const client = await createValidatorClient({ estimateResourceLimits: false });
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
        await getPermissionedConfidentialBurnInstructionPlan({
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
