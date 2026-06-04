import { getCreateAccountInstruction } from '@solana-program/system';
import {
    Address,
    TransactionMessage,
    Commitment,
    Instruction,
    InstructionPlan,
    Rpc,
    RpcSubscriptions,
    SolanaRpcApi,
    SolanaRpcSubscriptionsApi,
    TransactionMessageWithBlockhashLifetime,
    TransactionMessageWithFeePayer,
    TransactionSigner,
    airdropFactory,
    appendTransactionMessageInstructions,
    assertIsSendableTransaction,
    assertIsTransactionWithBlockhashLifetime,
    createSolanaRpc,
    createSolanaRpcSubscriptions,
    createTransactionMessage,
    createTransactionPlanExecutor,
    createTransactionPlanner,
    generateKeyPairSigner,
    getSignatureFromTransaction,
    isSome,
    lamports,
    none,
    pipe,
    sendAndConfirmTransactionFactory,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners,
    some,
} from '@solana/kit';
import { AeKey, ElGamalKeypair } from '@solana/zk-sdk/bundler';
import {
    Extension,
    ExtensionArgs,
    TOKEN_2022_PROGRAM_ADDRESS,
    Token,
    extension,
    fetchToken,
    findAssociatedTokenPda,
    getApplyConfidentialPendingBalanceInstructionFromToken,
    getConfidentialDepositInstruction,
    getCreateConfidentialTransferAccountInstructionPlan,
    getInitializeAccountInstruction,
    getInitializeMintInstruction,
    getMintSize,
    getMintToInstruction,
    getPostInitializeInstructionsForMintExtensions,
    getPostInitializeInstructionsForTokenExtensions,
    getPreInitializeInstructionsForMintExtensions,
    getTokenSize,
} from '../src';

export type Client = {
    rpc: Rpc<SolanaRpcApi>;
    rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>;
};

export const createDefaultSolanaClient = (): Client => {
    const rpc = createSolanaRpc('http://127.0.0.1:8899');
    const rpcSubscriptions = createSolanaRpcSubscriptions('ws://127.0.0.1:8900');
    return { rpc, rpcSubscriptions };
};

export const generateKeyPairSignerWithSol = async (client: Client, putativeLamports: bigint = 1_000_000_000n) => {
    const signer = await generateKeyPairSigner();
    await airdropFactory(client)({
        recipientAddress: signer.address,
        lamports: lamports(putativeLamports),
        commitment: 'confirmed',
    });
    return signer;
};

export const createDefaultTransaction = async (client: Client, feePayer: TransactionSigner) => {
    const { value: latestBlockhash } = await client.rpc.getLatestBlockhash().send();
    return pipe(
        createTransactionMessage({ version: 0 }),
        tx => setTransactionMessageFeePayerSigner(feePayer, tx),
        tx => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    );
};

export const signAndSendTransaction = async (
    client: Client,
    transactionMessage: TransactionMessage & TransactionMessageWithFeePayer & TransactionMessageWithBlockhashLifetime,
    commitment: Commitment = 'confirmed',
) => {
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    const signature = getSignatureFromTransaction(signedTransaction);
    assertIsSendableTransaction(signedTransaction);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    await sendAndConfirmTransactionFactory(client)(signedTransaction, { commitment });
    return signature;
};

export const sendAndConfirmInstructions = async (
    client: Client,
    payer: TransactionSigner,
    instructions: Instruction[],
) => {
    const signature = await pipe(
        await createDefaultTransaction(client, payer),
        tx => appendTransactionMessageInstructions(instructions, tx),
        tx => signAndSendTransaction(client, tx),
    );
    return signature;
};

export const sendAndConfirmInstructionPlan = async (
    client: Client,
    payer: TransactionSigner,
    instructionPlan: InstructionPlan,
) => {
    const planner = createTransactionPlanner({
        createTransactionMessage: () =>
            pipe(createTransactionMessage({ version: 0 }), tx => setTransactionMessageFeePayerSigner(payer, tx)),
    });
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory(client);
    const executor = createTransactionPlanExecutor({
        executeTransactionMessage: async (_context, message) => {
            const { value: latestBlockhash } = await client.rpc.getLatestBlockhash().send();
            const transaction = await pipe(setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, message), tx =>
                signTransactionMessageWithSigners(tx),
            );
            assertIsSendableTransaction(transaction);
            assertIsTransactionWithBlockhashLifetime(transaction);
            await sendAndConfirmTransaction(transaction, { commitment: 'confirmed' });
            return transaction;
        },
    });
    const transactionPlan = await planner(instructionPlan);
    return await executor(transactionPlan);
};

export const getCreateMintInstructions = async (input: {
    authority: Address;
    client: Client;
    decimals?: number;
    extensions?: ExtensionArgs[];
    freezeAuthority?: Address;
    mint: TransactionSigner;
    payer: TransactionSigner;
    programAddress?: Address;
}) => {
    const space = getMintSize(input.extensions);
    const postInitializeExtensions: Extension['__kind'][] = ['TokenMetadata', 'TokenGroup', 'TokenGroupMember'];
    const spaceWithoutPostInitializeExtensions = input.extensions
        ? getMintSize(input.extensions.filter(e => !postInitializeExtensions.includes(e.__kind)))
        : space;
    const rent = await input.client.rpc.getMinimumBalanceForRentExemption(BigInt(space)).send();
    return [
        getCreateAccountInstruction({
            payer: input.payer,
            newAccount: input.mint,
            lamports: rent,
            space: spaceWithoutPostInitializeExtensions,
            programAddress: input.programAddress ?? TOKEN_2022_PROGRAM_ADDRESS,
        }),
        getInitializeMintInstruction({
            mint: input.mint.address,
            decimals: input.decimals ?? 0,
            freezeAuthority: input.freezeAuthority,
            mintAuthority: input.authority,
        }),
    ];
};

export const getCreateTokenInstructions = async (input: {
    client: Client;
    extensions?: ExtensionArgs[];
    mint: Address;
    owner: Address;
    payer: TransactionSigner;
    programAddress?: Address;
    token: TransactionSigner;
}) => {
    const space = getTokenSize(input.extensions);
    const rent = await input.client.rpc.getMinimumBalanceForRentExemption(BigInt(space)).send();
    return [
        getCreateAccountInstruction({
            payer: input.payer,
            newAccount: input.token,
            lamports: rent,
            space,
            programAddress: input.programAddress ?? TOKEN_2022_PROGRAM_ADDRESS,
        }),
        getInitializeAccountInstruction({
            account: input.token.address,
            mint: input.mint,
            owner: input.owner,
        }),
    ];
};

export const createMint = async (
    input: Omit<Parameters<typeof getCreateMintInstructions>[0], 'authority' | 'mint'> & {
        authority: TransactionSigner;
        mint?: TransactionSigner;
    },
): Promise<Address> => {
    const mint = input.mint ?? (await generateKeyPairSigner());
    const [createAccount, initMint] = await getCreateMintInstructions({
        ...input,
        authority: input.authority.address,
        mint,
    });
    await sendAndConfirmInstructions(input.client, input.payer, [
        createAccount,
        ...getPreInitializeInstructionsForMintExtensions(mint.address, input.extensions ?? []),
        initMint,
        ...getPostInitializeInstructionsForMintExtensions(mint.address, input.authority, input.extensions ?? []),
    ]);
    return mint.address;
};

export const createToken = async (
    input: Omit<Parameters<typeof getCreateTokenInstructions>[0], 'token' | 'owner'> & { owner: TransactionSigner },
): Promise<Address> => {
    const token = await generateKeyPairSigner();
    const [createAccount, initToken] = await getCreateTokenInstructions({
        ...input,
        owner: input.owner.address,
        token,
    });
    await sendAndConfirmInstructions(input.client, input.payer, [
        createAccount,
        initToken,
        ...getPostInitializeInstructionsForTokenExtensions(token.address, input.owner, input.extensions ?? []),
    ]);
    return token.address;
};

export const createTokenWithAmount = async (
    input: Omit<Parameters<typeof getCreateTokenInstructions>[0], 'token' | 'owner'> & {
        amount: number | bigint;
        mintAuthority: TransactionSigner;
        owner: TransactionSigner;
    },
): Promise<Address> => {
    const token = await generateKeyPairSigner();
    const [createAccount, initToken] = await getCreateTokenInstructions({
        ...input,
        owner: input.owner.address,
        token,
    });
    await sendAndConfirmInstructions(input.client, input.payer, [
        createAccount,
        initToken,
        ...getPostInitializeInstructionsForTokenExtensions(token.address, input.owner, input.extensions ?? []),
        getMintToInstruction({
            mint: input.mint,
            token: token.address,
            mintAuthority: input.mintAuthority,
            amount: input.amount,
        }),
    ]);
    return token.address;
};

export const getTokenExtension = <TKind extends Extension['__kind']>(
    token: Token,
    kind: TKind,
): Extract<Extension, { __kind: TKind }> => {
    if (!isSome(token.extensions)) {
        throw new Error('Token account has no extensions.');
    }
    const found = token.extensions.value.find(e => e.__kind === kind);
    if (!found) {
        throw new Error(`Token account is missing the ${kind} extension.`);
    }
    return found as Extract<Extension, { __kind: TKind }>;
};

export const fetchAssociatedToken = async (client: Client, owner: Address, mint: Address): Promise<Token> => {
    const [token] = await findAssociatedTokenPda({ owner, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS, mint });
    const { data } = await fetchToken(client.rpc, token);
    return data;
};

// Creates a mint configured for confidential transfers with auto-approval, so
// that newly configured accounts are immediately usable without a separate
// approval from the confidential transfer mint authority.
export const createConfidentialMint = async (input: {
    client: Client;
    payer: TransactionSigner;
    decimals?: number;
}): Promise<{ mint: Address; mintAuthority: TransactionSigner }> => {
    const mintAuthority = await generateKeyPairSigner();
    const mint = await createMint({
        client: input.client,
        payer: input.payer,
        authority: mintAuthority,
        decimals: input.decimals ?? 2,
        extensions: [
            extension('ConfidentialTransferMint', {
                authority: some(mintAuthority.address),
                autoApproveNewAccounts: true,
                auditorElgamalPubkey: none(),
            }),
        ],
    });
    return { mint, mintAuthority };
};

export type ConfidentialTokenAccount = {
    token: Address;
    elgamalKeypair: ElGamalKeypair;
    aesKey: AeKey;
};

// Creates and configures an associated token account for confidential transfers.
export const createConfidentialTokenAccount = async (input: {
    client: Client;
    payer: TransactionSigner;
    owner: TransactionSigner;
    mint: Address;
}): Promise<ConfidentialTokenAccount> => {
    const elgamalKeypair = new ElGamalKeypair();
    const aesKey = new AeKey();
    const [token] = await findAssociatedTokenPda({
        owner: input.owner.address,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        mint: input.mint,
    });
    await sendAndConfirmInstructionPlan(
        input.client,
        input.payer,
        await getCreateConfidentialTransferAccountInstructionPlan({
            payer: input.payer,
            owner: input.owner,
            mint: input.mint,
            rpc: input.client.rpc,
            elgamalKeypair,
            aesKey,
        }),
    );
    return { token, elgamalKeypair, aesKey };
};

// Creates a confidential token account with `amount` tokens deposited and
// applied to its available confidential balance (ready to withdraw or transfer).
export const createConfidentialTokenAccountWithBalance = async (input: {
    client: Client;
    payer: TransactionSigner;
    owner: TransactionSigner;
    mint: Address;
    mintAuthority: TransactionSigner;
    decimals: number;
    amount: bigint;
}): Promise<ConfidentialTokenAccount> => {
    const account = await createConfidentialTokenAccount(input);

    // Mint public tokens, then deposit them into the confidential pending balance.
    await sendAndConfirmInstructions(input.client, input.payer, [
        getMintToInstruction({
            mint: input.mint,
            token: account.token,
            mintAuthority: input.mintAuthority,
            amount: input.amount,
        }),
        getConfidentialDepositInstruction({
            token: account.token,
            mint: input.mint,
            authority: input.owner,
            amount: input.amount,
            decimals: input.decimals,
        }),
    ]);

    // Apply the pending balance so the deposited amount becomes available.
    const { data: tokenAccount } = await fetchToken(input.client.rpc, account.token);
    await sendAndConfirmInstructions(input.client, input.payer, [
        getApplyConfidentialPendingBalanceInstructionFromToken({
            token: account.token,
            tokenAccount,
            authority: input.owner,
            elgamalSecretKey: account.elgamalKeypair.secret(),
            aesKey: account.aesKey,
        }),
    ]);

    return account;
};
