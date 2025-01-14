import type { ConfirmOptions, Connection, PublicKey, Signer, TransactionSignature } from '@solana/web3.js';
import { sendAndConfirmTransaction, Transaction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '../../constants.js';
import { createConfidentialTransferUpdateMintInstruction } from './instructions.js';
import type { PodElGamalPubkey } from '@solana/zk-sdk';

/**
 * Update confidential transfer mint
 *
 * @param connection                Connection to use
 * @param payer                     Payer of the transaction fees
 * @param mint                      The token mint
 * @param autoApproveNewAccounts    New auto-approve account policy
 * @param auditorElGamalPubkey      New Auditor ElGamal public key
 * @param authority                 Confidential transfer authority of the mint
 * @param confirmOptions            Options for confirming the transaction
 * @param programId                 SPL Token program account
 *
 * @return Signature of the confirmed transaction
 */
export async function updateMint(
    connection: Connection,
    payer: Signer,
    mint: PublicKey,
    autoApproveNewAccounts: boolean,
    auditorElGamalPubkey: PodElGamalPubkey | null,
    authority: Signer,
    confirmOptions?: ConfirmOptions,
    programId = TOKEN_2022_PROGRAM_ID,
): Promise<TransactionSignature> {
    const transaction = new Transaction().add(
        createConfidentialTransferUpdateMintInstruction(
            mint,
            authority.publicKey,
            autoApproveNewAccounts,
            auditorElGamalPubkey,
            programId,
        ),
    );

    return await sendAndConfirmTransaction(connection, transaction, [payer, authority], confirmOptions);
}
