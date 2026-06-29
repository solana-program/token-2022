import { expect, it } from 'vitest';

import { fetchToken, getConfidentialDepositInstruction, getMintToInstruction } from '../../../src';
import { decryptConfidentialTransferBalance, fetchConfidentialTransferBalance } from '../../../src/confidential';
import {
    createConfidentialMint,
    createConfidentialTokenAccountWithBalance,
    createValidatorClient,
    generateKeyPairSignerWithSol,
} from '../../_setup';

it('decrypts available and pending confidential balances', async () => {
    // Given a confidential token account with available and pending balances.
    const client = await createValidatorClient();
    const payer = client.payer;
    const owner = await generateKeyPairSignerWithSol(client);
    const { mint, mintAuthority } = await createConfidentialMint({ client, payer });
    const decimals = 2;
    const account = await createConfidentialTokenAccountWithBalance({
        client,
        payer,
        owner,
        mint,
        mintAuthority,
        decimals,
        amount: 1000n,
    });
    await client.sendTransaction([
        getMintToInstruction({ mint, token: account.token, mintAuthority, amount: 250n }),
        getConfidentialDepositInstruction({ token: account.token, mint, authority: owner, amount: 250n, decimals }),
    ]);

    // When the decoded account is decrypted locally.
    const { data: tokenAccount } = await fetchToken(client.rpc, account.token);
    const balance = decryptConfidentialTransferBalance({
        tokenAccount,
        elgamalSecretKey: account.elgamalKeypair.secret(),
        aesKey: account.aesKey,
    });

    // Then the helper reports available, pending, and total confidential balances.
    expect(balance.availableBalance).toBe(1000n);
    expect(balance.pendingBalance).toBe(250n);
    expect(balance.totalBalance).toBe(1250n);
    expect(balance.pendingBalanceCreditCounter).toBe(1n);

    await expect(
        fetchConfidentialTransferBalance({
            rpc: client.rpc,
            token: account.token,
            elgamalSecretKey: account.elgamalKeypair.secret(),
            aesKey: account.aesKey,
        }),
    ).resolves.toEqual(balance);
});
