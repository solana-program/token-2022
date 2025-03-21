import {
    clusterApiUrl,
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    sendAndConfirmTransaction,
    SystemProgram,
    Transaction,
} from '@solana/web3.js';
import {
    createInitializeGroupPointerInstruction,
    createInitializeGroupMemberPointerInstruction,
    createInitializeMintInstruction,
    ExtensionType,
    getMintLen,
    TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';

(async () => {
    const payer = Keypair.generate();
    const mint = Keypair.generate();
    const decimals = 9;
    const mintLen = getMintLen([ExtensionType.GroupPointer, ExtensionType.GroupMemberPointer]);

    const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

    const airdropSignature = await connection.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction({
        signature: airdropSignature,
        ...(await connection.getLatestBlockhash()),
    });

    const mintLamports = await connection.getMinimumBalanceForRentExemption(mintLen);
    const mintTransaction = new Transaction().add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: mint.publicKey,
            space: mintLen,
            lamports: mintLamports,
            programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeGroupPointerInstruction(mint.publicKey, payer.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID),
        createInitializeGroupMemberPointerInstruction(
            mint.publicKey,
            payer.publicKey,
            mint.publicKey,
            TOKEN_2022_PROGRAM_ID,
        ),
        createInitializeMintInstruction(mint.publicKey, decimals, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
    );
    const sig = await sendAndConfirmTransaction(connection, mintTransaction, [payer, mint]);
    console.log('Signature:', sig);
})();
