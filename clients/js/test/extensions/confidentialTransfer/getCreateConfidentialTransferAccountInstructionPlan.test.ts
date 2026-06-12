import { expect, it } from 'vitest';
import {
    createConfidentialMint,
    createConfidentialTokenAccount,
    createValidatorClient,
    fetchAssociatedToken,
    getTokenExtension,
} from '../../_setup';

it('configures a token account for confidential transfers', async () => {
    // Given a confidential transfer mint and an account owner.
    const client = await createValidatorClient();
    const owner = client.payer;
    const { mint } = await createConfidentialMint({ client, payer: owner });

    // When we create and configure an associated token account for confidential transfers.
    await createConfidentialTokenAccount({ client, payer: owner, owner, mint });

    // Then the token account has an approved ConfidentialTransferAccount extension.
    const tokenAccount = await fetchAssociatedToken(client, owner.address, mint);
    const confidentialAccount = getTokenExtension(tokenAccount, 'ConfidentialTransferAccount');
    expect(confidentialAccount.approved).toBe(true);
    expect(confidentialAccount.allowConfidentialCredits).toBe(true);
    expect(confidentialAccount.allowNonConfidentialCredits).toBe(true);
});
