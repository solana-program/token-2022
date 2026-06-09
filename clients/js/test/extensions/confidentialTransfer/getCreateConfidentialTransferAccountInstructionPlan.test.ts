import test from 'ava';
import {
    createConfidentialMint,
    createConfidentialTokenAccount,
    createDefaultSolanaClient,
    fetchAssociatedToken,
    generateKeyPairSignerWithSol,
    getTokenExtension,
} from '../../_setup';

test('it configures a token account for confidential transfers', async t => {
    // Given a confidential transfer mint and an account owner.
    const client = createDefaultSolanaClient();
    const owner = await generateKeyPairSignerWithSol(client);
    const { mint } = await createConfidentialMint({ client, payer: owner });

    // When we create and configure an associated token account for confidential transfers.
    await createConfidentialTokenAccount({ client, payer: owner, owner, mint });

    // Then the token account has an approved ConfidentialTransferAccount extension.
    const tokenAccount = await fetchAssociatedToken(client, owner.address, mint);
    const confidentialAccount = getTokenExtension(tokenAccount, 'ConfidentialTransferAccount');
    t.true(confidentialAccount.approved);
    t.true(confidentialAccount.allowConfidentialCredits);
    t.true(confidentialAccount.allowNonConfidentialCredits);
});
