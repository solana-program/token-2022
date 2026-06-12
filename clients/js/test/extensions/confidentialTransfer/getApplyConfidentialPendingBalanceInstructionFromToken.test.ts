import { expect, it } from 'vitest';
import { fetchToken, getConfidentialDepositInstruction, getMintToInstruction } from '../../../src';
import { getApplyConfidentialPendingBalanceInstructionFromToken } from '../../../src/confidential';
import {
    createConfidentialMint,
    createConfidentialTokenAccount,
    createValidatorClient,
    fetchAssociatedToken,
    getTokenExtension,
} from '../../_setup';

it('applies the pending balance to the available balance', async () => {
    // Given a confidential token account with a deposited (pending) balance.
    const client = await createValidatorClient();
    const owner = client.payer;
    const { mint, mintAuthority } = await createConfidentialMint({ client, payer: owner });
    const decimals = 2;
    const account = await createConfidentialTokenAccount({ client, payer: owner, owner, mint });
    await client.sendTransaction([
        getMintToInstruction({ mint, token: account.token, mintAuthority, amount: 1000n }),
        getConfidentialDepositInstruction({ token: account.token, mint, authority: owner, amount: 1000n, decimals }),
    ]);

    // When we apply the pending balance.
    const { data: tokenAccount } = await fetchToken(client.rpc, account.token);
    await client.sendTransaction([
        getApplyConfidentialPendingBalanceInstructionFromToken({
            token: account.token,
            tokenAccount,
            authority: owner,
            elgamalSecretKey: account.elgamalKeypair.secret(),
            aesKey: account.aesKey,
        }),
    ]);

    // Then the pending balance is consumed: its credit counter resets to zero
    // while the expected and actual applied counters reflect the single deposit.
    const updated = await fetchAssociatedToken(client, owner.address, mint);
    const confidentialAccount = getTokenExtension(updated, 'ConfidentialTransferAccount');
    expect(confidentialAccount.pendingBalanceCreditCounter).toBe(0n);
    expect(confidentialAccount.expectedPendingBalanceCreditCounter).toBe(1n);
    expect(confidentialAccount.actualPendingBalanceCreditCounter).toBe(1n);
});
