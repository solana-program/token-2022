import {
    clusterApiUrl,
    Connection,
    Keypair,
    sendAndConfirmTransaction,
    SystemProgram,
    Transaction,
    LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
    createInitializeMintInstruction,
    createInitializePausableConfigInstruction,
    getMintLen,
    pause,
    resume,
    ExtensionType,
    TOKEN_2022_PROGRAM_ID,
} from '../src';

(async () => {
    const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

    const payer = Keypair.generate();
    const airdropSignature = await connection.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction({ signature: airdropSignature, ...(await connection.getLatestBlockhash()) });

    const mintKeypair = Keypair.generate();
    const decimals = 9;
    const mintLen = getMintLen([ExtensionType.PausableConfig]);
    const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);
    const transaction = new Transaction().add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: mintKeypair.publicKey,
            space: mintLen,
            lamports,
            programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializePausableConfigInstruction(mintKeypair.publicKey, payer.publicKey, TOKEN_2022_PROGRAM_ID),
        createInitializeMintInstruction(
            mintKeypair.publicKey,
            decimals,
            payer.publicKey,
            payer.publicKey,
            TOKEN_2022_PROGRAM_ID,
        ),
    );
    await sendAndConfirmTransaction(connection, transaction, [payer, mintKeypair]);

    await pause(connection, payer, mintKeypair.publicKey, payer);
    await resume(connection, payer, mintKeypair.publicKey, payer);
})();
