import path from 'node:path';

import { systemProgram } from '@solana-program/system';
import {
    Address,
    Transaction,
    TransactionSigner,
    assertIsSendableTransaction,
    assertIsSingleTransactionPlanResult,
    assertIsTransactionWithBlockhashLifetime,
    createClient,
    createTransactionMessage,
    createTransactionPlanExecutor,
    createTransactionPlanner,
    extendClient,
    generateKeyPairSigner,
    isSome,
    lamports,
    none,
    pipe,
    sendAndConfirmTransactionFactory,
    sequentialInstructionPlan,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners,
    some,
} from '@solana/kit';
import { planAndSendTransactions } from '@solana/kit-plugin-instruction-plan';
import { TransactionMetadata, litesvm } from '@solana/kit-plugin-litesvm';
import { solanaLocalRpc } from '@solana/kit-plugin-rpc';
import { airdropSigner, generatedSigner } from '@solana/kit-plugin-signer';
import { AeKey, ElGamalKeypair } from '@solana/zk-sdk/bundler';

import {
    Extension,
    ExtensionArgs,
    TOKEN_2022_PROGRAM_ADDRESS,
    Token,
    associatedTokenProgram,
    extension,
    fetchToken,
    findAssociatedTokenPda,
    getConfidentialDepositInstruction,
    getCreateTokenInstructionPlan,
    getMintToInstruction,
    token2022Program,
} from '../src';
import {
    getApplyConfidentialPendingBalanceInstructionFromToken,
    getCreateConfidentialTransferAccountInstructionPlan,
} from '../src/confidential';

const TOKEN_2022_BINARY_PATH = path.resolve(__dirname, '..', '..', '..', 'target', 'deploy', 'spl_token_2022.so');

// The default test client runs against an in-process LiteSVM instance. The
// Token-2022 program is loaded from its compiled `.so`; the System, Associated
// Token and ZK ElGamal Proof program accounts are LiteSVM builtins.
export const createTestClient = () => {
    return createClient()
        .use(generatedSigner())
        .use(litesvm())
        .use(airdropSigner(lamports(1_000_000_000n)))
        .use(client => {
            // Must run after the `litesvm()` plugin so `client.svm` is available.
            client.svm.addProgramFromFile(TOKEN_2022_PROGRAM_ADDRESS, TOKEN_2022_BINARY_PATH);
            return client;
        })
        .use(systemProgram())
        .use(token2022Program())
        .use(associatedTokenProgram());
};

// A validator-backed client for the few confidential-transfer tests that
// verify zero-knowledge proofs. LiteSVM's builtin ZK ElGamal Proof program
// does not execute proof verification, so those tests must run against a local
// `solana-test-validator` (started by `make test-js-clients-js`).
//
// The planner and executor are overridden so that no compute-unit-limit
// instruction is added to any transaction. The default RPC planner reserves
// ~40 bytes for a provisory compute-unit limit and the default RPC executor
// estimates and sets a real one before sending; either is enough to push the
// largest proof-verification transaction (the batched range proof, which must
// share a transaction with its context-state account creation) past the
// transaction size limit. Omitting it is safe: a versioned transaction with no
// compute-unit limit still receives the per-instruction default budget.
export const createValidatorClient = () => {
    return (
        createClient()
            .use(generatedSigner())
            .use(solanaLocalRpc())
            .use(airdropSigner(lamports(1_000_000_000n)))
            .use(client =>
                extendClient(client, {
                    // A planner that builds a bare versioned message with no
                    // provisory compute-unit-limit instruction.
                    transactionPlanner: createTransactionPlanner({
                        createTransactionMessage: () =>
                            pipe(createTransactionMessage({ version: 0 }), tx =>
                                setTransactionMessageFeePayerSigner(client.payer, tx),
                            ),
                    }),
                    // An executor that sets the blockhash, signs and sends — but
                    // never estimates or sets a compute-unit limit (unlike the
                    // default RPC executor, which would re-add the instruction at
                    // execution time, after planning validated the size).
                    transactionPlanExecutor: createTransactionPlanExecutor({
                        executeTransactionMessage: async (_context, message) => {
                            const { value: latestBlockhash } = await client.rpc.getLatestBlockhash().send();
                            const transaction = await pipe(
                                setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, message),
                                tx => signTransactionMessageWithSigners(tx),
                            );
                            assertIsSendableTransaction(transaction);
                            assertIsTransactionWithBlockhashLifetime(transaction);
                            await sendAndConfirmTransactionFactory(client)(transaction, { commitment: 'confirmed' });
                            return transaction;
                        },
                    }),
                }),
            )
            // Re-wire `sendTransaction(s)` so they capture the client with the
            // overridden planner and executor above.
            .use(planAndSendTransactions())
            .use(systemProgram())
            .use(token2022Program())
            .use(associatedTokenProgram())
    );
};

export type LiteSvmClient = Awaited<ReturnType<typeof createTestClient>>;
export type ValidatorClient = Awaited<ReturnType<typeof createValidatorClient>>;
export type Client = LiteSvmClient | ValidatorClient;

export const generateKeyPairSignerWithSol = async (client: Client, putativeLamports: bigint = 1_000_000_000n) => {
    const signer = await generateKeyPairSigner();
    await client.airdrop(signer.address, lamports(putativeLamports));
    return signer;
};

type SingleSendResult = Awaited<ReturnType<LiteSvmClient['sendTransaction']>>;

// The context of a single, successful LiteSVM transaction: the executed
// transaction (with its compiled message bytes) and the LiteSVM
// `TransactionMetadata` (return data, logs, etc.).
type ExecutedTransactionContext = {
    transaction: Transaction;
    transactionMetadata: TransactionMetadata;
};

// Narrows the result of `client.sendTransaction` to the context of its single,
// successful transaction. Asserts the result is indeed a single transaction
// plan result before exposing the LiteSVM-specific context typing.
export const getSingleTransactionContext = (result: SingleSendResult): ExecutedTransactionContext => {
    assertIsSingleTransactionPlanResult(result);
    return result.context as unknown as ExecutedTransactionContext;
};

export const createToken = async (input: {
    client: Client;
    payer: TransactionSigner;
    mint: Address;
    owner: TransactionSigner;
    extensions?: ExtensionArgs[];
}): Promise<Address> => {
    const token = await generateKeyPairSigner();
    await input.client.token2022.instructions
        .createToken({
            payer: input.payer,
            newToken: token,
            mint: input.mint,
            owner: input.owner,
            extensions: input.extensions,
        })
        .sendTransaction();
    return token.address;
};

export const createTokenWithAmount = async (input: {
    client: Client;
    payer: TransactionSigner;
    mint: Address;
    owner: TransactionSigner;
    mintAuthority: TransactionSigner;
    amount: number | bigint;
    extensions?: ExtensionArgs[];
}): Promise<Address> => {
    const token = await generateKeyPairSigner();
    await input.client.sendTransaction(
        sequentialInstructionPlan([
            getCreateTokenInstructionPlan({
                payer: input.payer,
                newToken: token,
                mint: input.mint,
                owner: input.owner,
                extensions: input.extensions,
            }),
            getMintToInstruction({
                mint: input.mint,
                token: token.address,
                mintAuthority: input.mintAuthority,
                amount: input.amount,
            }),
        ]),
    );
    return token.address;
};

// Mints `amount` tokens to an owner's associated token account (created if
// needed) via the plugin's `mintToATA` helper, and returns the ATA address.
export const createTokenPdaWithAmount = async (input: {
    client: Client;
    mint: Address;
    mintAuthority: TransactionSigner;
    owner: Address;
    amount: bigint;
    decimals: number;
}): Promise<Address> => {
    await input.client.token2022.instructions
        .mintToATA({
            mint: input.mint,
            owner: input.owner,
            mintAuthority: input.mintAuthority,
            amount: input.amount,
            decimals: input.decimals,
        })
        .sendTransaction();
    const [token] = await findAssociatedTokenPda({
        owner: input.owner,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        mint: input.mint,
    });
    return token;
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
    auditorElgamalPubkey?: Address;
}): Promise<{ mint: Address; mintAuthority: TransactionSigner }> => {
    const [mintAuthority, mint] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    await input.client.token2022.instructions
        .createMint({
            payer: input.payer,
            newMint: mint,
            decimals: input.decimals ?? 2,
            mintAuthority,
            extensions: [
                extension('ConfidentialTransferMint', {
                    authority: some(mintAuthority.address),
                    autoApproveNewAccounts: true,
                    auditorElgamalPubkey: input.auditorElgamalPubkey ? some(input.auditorElgamalPubkey) : none(),
                }),
            ],
        })
        .sendTransaction();
    return { mint: mint.address, mintAuthority };
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
    await input.client.sendTransaction(
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
    await input.client.sendTransaction([
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
    await input.client.sendTransaction([
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
