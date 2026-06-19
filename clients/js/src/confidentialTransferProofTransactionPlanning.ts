import {
    assertIsSendableTransaction,
    assertIsTransactionWithBlockhashLifetime,
    ClientWithPayer,
    ClientWithRpc,
    ClientWithRpcSubscriptions,
    createTransactionMessage,
    createTransactionPlanExecutor,
    createTransactionPlanner,
    extendClient,
    GetEpochInfoApi,
    GetLatestBlockhashApi,
    GetSignatureStatusesApi,
    pipe,
    sendAndConfirmTransactionFactory,
    SendTransactionApi,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    SignatureNotificationsApi,
    signTransactionMessageWithSigners,
    SlotNotificationsApi,
} from '@solana/kit';

type ConfidentialTransferProofTransactionPlanningRequirements = ClientWithPayer &
    ClientWithRpc<GetEpochInfoApi & GetLatestBlockhashApi & GetSignatureStatusesApi & SendTransactionApi> &
    ClientWithRpcSubscriptions<SignatureNotificationsApi & SlotNotificationsApi>;

/**
 * Overrides a client to send confidential-transfer proof transactions without
 * adding compute-budget instructions.
 *
 * Some confidential-transfer proof verification instructions are close to the
 * current transaction size limit. The default RPC planner reserves space for a
 * provisional compute-unit-limit instruction, and the default RPC executor later
 * replaces it with an estimated limit. Either compute-budget instruction can be
 * enough overhead to make the largest proof transaction exceed the message size
 * limit. This plugin avoids that byte overhead while larger transaction messages
 * are not yet available and broadly adopted by clients.
 *
 * Install this plugin after the RPC and payer plugins, and before
 * `planAndSendTransactions()`.
 */
export function confidentialTransferProofTransactionPlanning() {
    return <T extends ConfidentialTransferProofTransactionPlanningRequirements>(client: T) => {
        const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({
            rpc: client.rpc,
            rpcSubscriptions: client.rpcSubscriptions,
        });

        return extendClient(client, {
            transactionPlanner: createTransactionPlanner({
                createTransactionMessage: () =>
                    pipe(createTransactionMessage({ version: 0 }), tx =>
                        setTransactionMessageFeePayerSigner(client.payer, tx),
                    ),
            }),
            transactionPlanExecutor: createTransactionPlanExecutor({
                executeTransactionMessage: async (_context, message, executorConfig) => {
                    const { value: latestBlockhash } = await client.rpc.getLatestBlockhash().send(executorConfig);
                    const transaction = await pipe(
                        setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, message),
                        tx => signTransactionMessageWithSigners(tx, executorConfig),
                    );
                    assertIsSendableTransaction(transaction);
                    assertIsTransactionWithBlockhashLifetime(transaction);
                    await sendAndConfirmTransaction(transaction, {
                        commitment: 'confirmed',
                        ...executorConfig,
                    });
                    return transaction;
                },
            }),
        });
    };
}
