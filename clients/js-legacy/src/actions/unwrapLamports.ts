import type { ConfirmOptions, Connection, PublicKey, Signer, TransactionSignature } from '@solana/web3.js';
import { sendAndConfirmTransaction, Transaction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '../constants.js';
import { getSigners } from './internal.js';
import { createUnwrapLamportsInstruction } from '../instructions/unwrapLamports.js';

/**
 * Unwrap lamports to an account
 *
 * @param connection     Connection to use
 * @param payer          Payer of the transaction fees
 * @param source         Native source account
 * @param destination    Account receiving the lamports
 * @param owner          Owner of the source account
 * @param amount         Amount of lamports to unwrap
 * @param multiSigners   Signing accounts if `authority` is a multisig
 * @param confirmOptions Options for confirming the transaction
 * @param programId      SPL Token program account
 *
 * @return Signature of the confirmed transaction
 */
export async function unwrapLamports(
    connection: Connection,
    payer: Signer,
    source: PublicKey,
    destination: PublicKey,
    owner: Signer | PublicKey,
    amount: bigint | null,
    multiSigners: Signer[] = [],
    confirmOptions?: ConfirmOptions,
    programId = TOKEN_2022_PROGRAM_ID,
): Promise<TransactionSignature> {
    const [ownerPublicKey, signers] = getSigners(owner, multiSigners);

    const transaction = new Transaction().add(
        createUnwrapLamportsInstruction(source, destination, ownerPublicKey, amount, multiSigners, programId),
    );

    return await sendAndConfirmTransaction(connection, transaction, [payer, ...signers], confirmOptions);
}
