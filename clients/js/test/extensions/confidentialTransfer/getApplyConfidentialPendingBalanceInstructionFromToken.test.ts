import test from 'ava';
import { fetchToken, getConfidentialDepositInstruction, getMintToInstruction } from '../../../src';
import { getApplyConfidentialPendingBalanceInstructionFromToken } from '../../../src/confidential';
import {
    createConfidentialMint,
    createConfidentialTokenAccount,
    createDefaultSolanaClient,
    fetchAssociatedToken,
    generateKeyPairSignerWithSol,
    getTokenExtension,
    sendAndConfirmInstructions,
} from '../../_setup';

test('it applies the pending balance to the available balance', async t => {
    // Given a confidential token account with a deposited (pending) balance.
    const client = createDefaultSolanaClient();
    const owner = await generateKeyPairSignerWithSol(client);
    const { mint, mintAuthority } = await createConfidentialMint({ client, payer: owner });
    const decimals = 2;
    const account = await createConfidentialTokenAccount({ client, payer: owner, owner, mint });
    await sendAndConfirmInstructions(client, owner, [
        getMintToInstruction({ mint, token: account.token, mintAuthority, amount: 1000n }),
        getConfidentialDepositInstruction({ token: account.token, mint, authority: owner, amount: 1000n, decimals }),
    ]);

    // When we apply the pending balance.
    const { data: tokenAccount } = await fetchToken(client.rpc, account.token);
    await sendAndConfirmInstructions(client, owner, [
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
    t.is(confidentialAccount.pendingBalanceCreditCounter, 0n);
    t.is(confidentialAccount.expectedPendingBalanceCreditCounter, 1n);
    t.is(confidentialAccount.actualPendingBalanceCreditCounter, 1n);
});
