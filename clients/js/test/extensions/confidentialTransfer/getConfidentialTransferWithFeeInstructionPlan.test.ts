import { ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS, ZkElGamalProofInstruction } from '@solana-program/zk-elgamal-proof';
import {
    Address,
    Instruction,
    InstructionPlan,
    SOLANA_ERROR__INSTRUCTION_ERROR__INVALID_INSTRUCTION_DATA,
    TransactionSigner,
    createClient,
    generateKeyPairSigner,
    getAddressDecoder,
    getSignatureFromTransaction,
    getTransactionSize,
    getTransactionSizeLimit,
    isSignerRole,
    isSolanaError,
    none,
    nonDivisibleSequentialInstructionPlan,
    some,
    type ReadonlyUint8Array,
} from '@solana/kit';
import { solanaLocalRpc } from '@solana/kit-plugin-rpc';
import { payer as withPayer } from '@solana/kit-plugin-signer';
import { SYSVAR_INSTRUCTIONS_ADDRESS } from '@solana/sysvars';
import { AeCiphertext, AeKey, ElGamalCiphertext, ElGamalKeypair } from '@solana/zk-sdk/bundler';
import { expect, it } from 'vitest';

import {
    ExtensionArgs,
    Mint,
    TOKEN_2022_PROGRAM_ADDRESS,
    Token,
    extension,
    fetchMint,
    fetchToken,
    getConfidentialDepositInstruction,
    getConfidentialTransferWithFeeInstructionDataDecoder,
    getMintToInstruction,
} from '../../../src';
import {
    getApplyConfidentialPendingBalanceInstructionFromToken,
    getConfidentialTransferWithFeeInstructionPlan,
    getConfidentialTransferWithFeeWithInstructionOffsetProofsInstructionPlan,
} from '../../../src/confidential';
import {
    createConfidentialTokenAccount,
    createConfidentialTokenAccountWithBalance,
    createMultisig,
    createValidatorClient,
    generateKeyPairSignerWithSol,
    getTokenExtension,
    getSingleTransactionContext,
    getRootCauseOfRejection,
    type ValidatorClient,
} from '../../_setup';

function elgamalPubkeyAsAddress(keypair: ElGamalKeypair): Address {
    return getAddressDecoder().decode(new Uint8Array(keypair.pubkey().toBytes()));
}

async function expectInvalidProofInstruction(promise: Promise<unknown>) {
    const error = await getRootCauseOfRejection(promise);
    expect(isSolanaError(error, SOLANA_ERROR__INSTRUCTION_ERROR__INVALID_INSTRUCTION_DATA)).toBe(true);
    expect(error).toMatchObject({ context: { index: 0 } });
}

function parseElGamalCiphertext(bytes: ReadonlyUint8Array) {
    const ciphertext = ElGamalCiphertext.fromBytes(new Uint8Array(bytes));
    if (!ciphertext) {
        throw new Error('Failed to deserialize ElGamal ciphertext.');
    }
    return ciphertext;
}

function decryptAvailableBalance(tokenAccount: Token, aesKey: AeKey) {
    const confidentialTransferAccount = getTokenExtension(tokenAccount, 'ConfidentialTransferAccount');
    const ciphertext = AeCiphertext.fromBytes(new Uint8Array(confidentialTransferAccount.decryptableAvailableBalance));
    if (!ciphertext) {
        throw new Error('Failed to deserialize decryptable available balance.');
    }
    return aesKey.decrypt(ciphertext);
}

function decryptPendingBalance(tokenAccount: Token, elgamalKeypair: ElGamalKeypair) {
    const confidentialTransferAccount = getTokenExtension(tokenAccount, 'ConfidentialTransferAccount');
    const amountLo = elgamalKeypair
        .secret()
        .decrypt(parseElGamalCiphertext(confidentialTransferAccount.pendingBalanceLow));
    const amountHi = elgamalKeypair
        .secret()
        .decrypt(parseElGamalCiphertext(confidentialTransferAccount.pendingBalanceHigh));
    return (amountHi << 16n) + amountLo;
}

function decryptWithheldAmount(tokenAccount: Token, withdrawWithheldAuthorityElGamalKeypair: ElGamalKeypair) {
    const confidentialTransferFeeAmount = getTokenExtension(tokenAccount, 'ConfidentialTransferFeeAmount');
    const ciphertext = parseElGamalCiphertext(confidentialTransferFeeAmount.withheldAmount);
    return withdrawWithheldAuthorityElGamalKeypair.secret().decrypt(ciphertext);
}

async function createConfidentialTransferFeeMint(input: {
    client: ValidatorClient;
    payer: TransactionSigner;
    decimals: number;
    maximumFee: bigint;
    transferFeeBasisPoints: number;
    auditorElgamalPubkey?: Address;
}): Promise<{
    mint: Address;
    mintAuthority: TransactionSigner;
    withdrawWithheldAuthorityElGamalKeypair: ElGamalKeypair;
}> {
    const [mintAuthority, mint, confidentialTransferAuthority] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const transferFees = {
        epoch: 0n,
        maximumFee: input.maximumFee,
        transferFeeBasisPoints: input.transferFeeBasisPoints,
    };
    const withdrawWithheldAuthorityElGamalKeypair = new ElGamalKeypair();
    const withdrawWithheldAuthorityElGamalPubkey = elgamalPubkeyAsAddress(withdrawWithheldAuthorityElGamalKeypair);
    const extensions: ExtensionArgs[] = [
        extension('TransferFeeConfig', {
            transferFeeConfigAuthority: confidentialTransferAuthority.address,
            withdrawWithheldAuthority: confidentialTransferAuthority.address,
            withheldAmount: 0n,
            olderTransferFee: transferFees,
            newerTransferFee: transferFees,
        }),
        extension('ConfidentialTransferMint', {
            authority: some(confidentialTransferAuthority.address),
            autoApproveNewAccounts: true,
            auditorElgamalPubkey: input.auditorElgamalPubkey ? some(input.auditorElgamalPubkey) : none(),
        }),
        extension('ConfidentialTransferFee', {
            authority: some(confidentialTransferAuthority.address),
            elgamalPubkey: withdrawWithheldAuthorityElGamalPubkey,
            harvestToMintEnabled: true,
            withheldAmount: new Uint8Array(64).fill(0),
        }),
    ];

    await input.client.token2022.instructions
        .createMint({
            payer: input.payer,
            newMint: mint,
            decimals: input.decimals,
            mintAuthority,
            extensions,
        })
        .sendTransaction();

    return { mint: mint.address, mintAuthority, withdrawWithheldAuthorityElGamalKeypair };
}

/**
 * Sets up a confidential-transfer-fee mint with a funded source account and an
 * empty destination account, confidentially transfers `amount` from source to
 * destination, and returns the decrypted post-transfer balances so each test
 * can assert its own expected values.
 */
async function runTransferWithFee(input: {
    initialSourceAmount: bigint;
    amount: bigint;
    maximumFee: bigint;
    transferFeeBasisPoints: number;
    instructionOffset?: boolean;
    checkInvalidProofs?: boolean;
    auditorAndMultisig?: boolean;
}): Promise<{
    sourceAvailableBalance: bigint;
    destinationPendingBalance: bigint;
    destinationWithheldAmount: bigint;
    destinationPendingBalanceCreditCounter: bigint;
}> {
    const client = await createValidatorClient();
    const payer = client.payer;
    const [sourceOwner, destinationOwner] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSignerWithSol(client),
    ]);
    const decimals = 2;
    const auditor = input.auditorAndMultisig ? new ElGamalKeypair() : undefined;
    const { mint, mintAuthority, withdrawWithheldAuthorityElGamalKeypair } = await createConfidentialTransferFeeMint({
        client,
        payer,
        decimals,
        maximumFee: input.maximumFee,
        transferFeeBasisPoints: input.transferFeeBasisPoints,
        auditorElgamalPubkey: auditor ? elgamalPubkeyAsAddress(auditor) : undefined,
    });
    const multiSigners = input.auditorAndMultisig
        ? [sourceOwner, await generateKeyPairSignerWithSol(client)]
        : undefined;
    const authority = multiSigners ? await createMultisig({ client, payer, signers: multiSigners }) : sourceOwner;
    const source = multiSigners
        ? await createConfidentialTokenAccount({
              client,
              payer,
              owner: authority,
              mint,
              multiSigners,
              includeConfidentialTransferFeeAmount: true,
          })
        : await createConfidentialTokenAccountWithBalance({
              client,
              payer,
              owner: sourceOwner,
              mint,
              mintAuthority,
              decimals,
              amount: input.initialSourceAmount,
              includeConfidentialTransferFeeAmount: true,
          });
    if (multiSigners) {
        await client.sendTransaction([
            getMintToInstruction({ mint, token: source.token, mintAuthority, amount: input.initialSourceAmount }),
            getConfidentialDepositInstruction({
                token: source.token,
                mint,
                authority,
                multiSigners,
                amount: input.initialSourceAmount,
                decimals,
            }),
        ]);
        const { data: tokenAccount } = await fetchToken(client.rpc, source.token);
        await client.sendTransaction([
            getApplyConfidentialPendingBalanceInstructionFromToken({
                token: source.token,
                tokenAccount,
                authority,
                multiSigners,
                elgamalSecretKey: source.elgamalKeypair.secret(),
                aesKey: source.aesKey,
            }),
        ]);
    }
    const destination = await createConfidentialTokenAccount({
        client,
        payer,
        owner: destinationOwner,
        mint,
        includeConfidentialTransferFeeAmount: true,
    });

    const [{ data: sourceTokenAccount }, { data: destinationTokenAccount }, { data: mintAccount }, epochInfo] =
        await Promise.all([
            fetchToken(client.rpc, source.token),
            fetchToken(client.rpc, destination.token),
            fetchMint(client.rpc, mint),
            client.rpc.getEpochInfo().send(),
        ]);
    const transferInput = {
        sourceToken: source.token,
        mint,
        destinationToken: destination.token,
        sourceTokenAccount,
        destinationTokenAccount,
        mintAccount,
        currentEpoch: epochInfo.epoch,
        authority,
        multiSigners,
        amount: input.amount,
        sourceElgamalKeypair: source.elgamalKeypair,
        aesKey: source.aesKey,
    };
    if (input.instructionOffset) {
        const plan = getConfidentialTransferWithFeeWithInstructionOffsetProofsInstructionPlan(transferInput);
        const instructions = getInstructions(plan);
        expect(instructions).toHaveLength(6);
        const [transfer, ...proofs] = instructions;
        expect(transfer.accounts?.map(account => account.address)).toEqual([
            source.token,
            mint,
            destination.token,
            SYSVAR_INSTRUCTIONS_ADDRESS,
            ...(multiSigners ? [authority, ...multiSigners.map(signer => signer.address)] : [sourceOwner.address]),
        ]);
        expect(
            transfer.accounts?.filter(account => isSignerRole(account.role)).map(account => account.address),
        ).toEqual(multiSigners ? multiSigners.map(signer => signer.address) : [sourceOwner.address]);
        const transferData = getConfidentialTransferWithFeeInstructionDataDecoder().decode(transfer.data!);
        expect(transferData).toMatchObject({
            equalityProofInstructionOffset: 1,
            transferAmountCiphertextValidityProofInstructionOffset: 2,
            feeSigmaProofInstructionOffset: 3,
            feeCiphertextValidityProofInstructionOffset: 4,
            rangeProofInstructionOffset: 5,
        });
        if (auditor) {
            expect(
                auditor.secret().decrypt(parseElGamalCiphertext(transferData.transferAmountAuditorCiphertextLo)),
            ).toBe(input.amount);
            const mismatchedAuditor = getConfidentialTransferWithFeeWithInstructionOffsetProofsInstructionPlan({
                ...transferInput,
                auditorElgamalPubkey: elgamalPubkeyAsAddress(new ElGamalKeypair()),
            });
            await expect(client.sendTransaction(mismatchedAuditor)).rejects.toThrow();
        }
        if (multiSigners) {
            await expect(
                client.sendTransaction(
                    nonDivisibleSequentialInstructionPlan([
                        { ...transfer, accounts: transfer.accounts!.slice(0, -1) },
                        ...proofs,
                    ]),
                ),
            ).rejects.toThrow();
        }
        expect(proofs.map(ix => ix.programAddress)).toEqual(Array(5).fill(ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS));
        expect(proofs.map(ix => ix.accounts ?? [])).toEqual([[], [], [], [], []]);
        expect(proofs.map(ix => ix.data?.[0])).toEqual([
            ZkElGamalProofInstruction.VerifyCiphertextCommitmentEquality,
            ZkElGamalProofInstruction.VerifyBatchedGroupedCiphertext3HandlesValidity,
            ZkElGamalProofInstruction.VerifyPercentageWithCap,
            ZkElGamalProofInstruction.VerifyBatchedGroupedCiphertext2HandlesValidity,
            ZkElGamalProofInstruction.VerifyBatchedRangeProofU256,
        ]);
        if (input.checkInvalidProofs) {
            await expectInvalidProofInstruction(
                client.sendTransaction(nonDivisibleSequentialInstructionPlan(instructions.slice(0, -1))),
            );
            await expectInvalidProofInstruction(
                client.sendTransaction(
                    nonDivisibleSequentialInstructionPlan([
                        transfer,
                        proofs[0],
                        proofs[1],
                        proofs[3],
                        proofs[2],
                        proofs[4],
                    ]),
                ),
            );
            await expectInvalidProofInstruction(
                client.sendTransaction(
                    nonDivisibleSequentialInstructionPlan([
                        transfer,
                        { ...proofs[0], programAddress: TOKEN_2022_PROGRAM_ADDRESS },
                        ...proofs.slice(1),
                    ]),
                ),
            );
            const [, otherEquality] = getInstructions(
                getConfidentialTransferWithFeeWithInstructionOffsetProofsInstructionPlan({
                    ...transferInput,
                    amount: 100n,
                }),
            );
            const mismatchedProofError = await getRootCauseOfRejection(
                client.sendTransaction(
                    nonDivisibleSequentialInstructionPlan([transfer, otherEquality, ...proofs.slice(1)]),
                ),
            );
            expect(mismatchedProofError).toMatchObject({ context: { index: 0 } });
            const badRangeData = new Uint8Array(proofs[4].data!);
            badRangeData[badRangeData.length - 1] ^= 1;
            const signaturesBefore = await client.rpc.getSignaturesForAddress(source.token, { limit: 1 }).send();
            const noPreflightClient = createClient()
                .use(withPayer(payer))
                .use(solanaLocalRpc({ skipPreflight: true }));
            await expect(
                noPreflightClient.sendTransaction(
                    nonDivisibleSequentialInstructionPlan([
                        transfer,
                        ...proofs.slice(0, 4),
                        { ...proofs[4], data: badRangeData },
                    ]),
                ),
            ).rejects.toThrow();
            const signaturesAfter = await client.rpc.getSignaturesForAddress(source.token, { limit: 1 }).send();
            expect(signaturesAfter[0].signature).not.toBe(signaturesBefore[0].signature);
            const failedTransaction = await client.rpc
                .getTransaction(signaturesAfter[0].signature, {
                    commitment: 'confirmed',
                    encoding: 'base64',
                    maxSupportedTransactionVersion: 1,
                })
                .send();
            expect(failedTransaction?.meta?.err).toMatchObject({ InstructionError: [5n, expect.anything()] });
            const [{ data: sourceAfterFailure }, { data: destinationAfterFailure }] = await Promise.all([
                fetchToken(client.rpc, source.token),
                fetchToken(client.rpc, destination.token),
            ]);
            expect(decryptAvailableBalance(sourceAfterFailure, source.aesKey)).toBe(input.initialSourceAmount);
            expect(decryptPendingBalance(destinationAfterFailure, destination.elgamalKeypair)).toBe(0n);
            expect(decryptWithheldAmount(destinationAfterFailure, withdrawWithheldAuthorityElGamalKeypair)).toBe(0n);
        }
        const { transaction } = getSingleTransactionContext(await client.sendTransaction(plan));
        expect(getTransactionSizeLimit(transaction)).toBe(4096);
        expect(getTransactionSize(transaction)).toBeLessThanOrEqual(4096);
        const confirmed = await client.rpc
            .getTransaction(getSignatureFromTransaction(transaction), {
                commitment: 'confirmed',
                encoding: 'base64',
                maxSupportedTransactionVersion: 1,
            })
            .send();
        expect(confirmed?.meta?.computeUnitsConsumed).toBeDefined();
    } else {
        await client.sendTransactions(
            await getConfidentialTransferWithFeeInstructionPlan({
                ...transferInput,
                payer,
                rpc: client.rpc,
            }),
        );
    }

    const [{ data: updatedSource }, { data: updatedDestination }] = await Promise.all([
        fetchToken(client.rpc, source.token),
        fetchToken(client.rpc, destination.token),
    ]);
    return {
        sourceAvailableBalance: decryptAvailableBalance(updatedSource, source.aesKey),
        destinationPendingBalance: decryptPendingBalance(updatedDestination, destination.elgamalKeypair),
        destinationWithheldAmount: decryptWithheldAmount(updatedDestination, withdrawWithheldAuthorityElGamalKeypair),
        destinationPendingBalanceCreditCounter: getTokenExtension(updatedDestination, 'ConfidentialTransferAccount')
            .pendingBalanceCreditCounter,
    };
}

function getInstructions(plan: InstructionPlan): Instruction[] {
    if (plan.kind !== 'sequential') throw new Error('Expected a sequential plan.');
    expect(plan.divisible).toBe(false);
    return plan.plans.map(child => {
        if (child.kind !== 'single') throw new Error('Expected a single instruction.');
        return child.instruction;
    });
}

it.each([
    { maximumFee: 1_000_000_000n, transferFeeBasisPoints: 150, expectedNet: 197n, expectedFee: 3n },
    { maximumFee: 2n, transferFeeBasisPoints: 150, expectedNet: 198n, expectedFee: 2n },
    { maximumFee: 1_000_000_000n, transferFeeBasisPoints: 0, expectedNet: 200n, expectedFee: 0n },
])(
    'transfers with inline proofs and fee $expectedFee',
    async ({ maximumFee, transferFeeBasisPoints, expectedNet, expectedFee }) => {
        const result = await runTransferWithFee({
            initialSourceAmount: 1000n,
            amount: 200n,
            maximumFee,
            transferFeeBasisPoints,
            instructionOffset: true,
            checkInvalidProofs: expectedFee === 3n,
        });
        expect(result).toEqual({
            sourceAvailableBalance: 800n,
            destinationPendingBalance: expectedNet,
            destinationWithheldAmount: expectedFee,
            destinationPendingBalanceCreditCounter: 1n,
        });
    },
);

it('transfers tokens confidentially with fees', async () => {
    // When the source confidentially transfers 2.00 tokens with a 1.5% fee (uncapped).
    // fee = ceil(200 * 150 / 10_000) = 3, net = 197.
    const result = await runTransferWithFee({
        initialSourceAmount: 1000n,
        amount: 200n,
        maximumFee: 1_000_000_000n,
        transferFeeBasisPoints: 150,
    });

    // Then the source is debited by the gross amount, the destination receives the net amount,
    // and the confidential fee amount is withheld on the destination account.
    expect(result.sourceAvailableBalance).toBe(800n);
    expect(result.destinationPendingBalance).toBe(197n);
    expect(result.destinationWithheldAmount).toBe(3n);
    expect(result.destinationPendingBalanceCreditCounter).toBe(1n);
});

it('transfers with inline fee proofs from a multisig account with an auditor', async () => {
    const result = await runTransferWithFee({
        initialSourceAmount: 1000n,
        amount: 200n,
        maximumFee: 1_000_000_000n,
        transferFeeBasisPoints: 150,
        instructionOffset: true,
        auditorAndMultisig: true,
    });
    expect(result).toEqual({
        sourceAvailableBalance: 800n,
        destinationPendingBalance: 197n,
        destinationWithheldAmount: 3n,
        destinationPendingBalanceCreditCounter: 1n,
    });
});

it('caps the confidential fee at the maximum fee', async () => {
    // When the raw 1.5% fee (3) exceeds the maximum fee (2), the fee is capped at 2 and
    // `claimedDeltaFee` is 0. net = 200 - 2 = 198.
    const result = await runTransferWithFee({
        initialSourceAmount: 1000n,
        amount: 200n,
        maximumFee: 2n,
        transferFeeBasisPoints: 150,
    });

    // Then the source is still debited by the gross amount, the destination receives the
    // capped net amount, and only the maximum fee is withheld.
    expect(result.sourceAvailableBalance).toBe(800n);
    expect(result.destinationPendingBalance).toBe(198n);
    expect(result.destinationWithheldAmount).toBe(2n);
    expect(result.destinationPendingBalanceCreditCounter).toBe(1n);
});

it('transfers the full amount when the fee basis points are zero', async () => {
    // When the fee basis points are 0, no fee is charged. net = 200.
    const result = await runTransferWithFee({
        initialSourceAmount: 1000n,
        amount: 200n,
        maximumFee: 1_000_000_000n,
        transferFeeBasisPoints: 0,
    });

    // Then the destination receives the full amount and nothing is withheld.
    expect(result.sourceAvailableBalance).toBe(800n);
    expect(result.destinationPendingBalance).toBe(200n);
    expect(result.destinationWithheldAmount).toBe(0n);
    expect(result.destinationPendingBalanceCreditCounter).toBe(1n);
});

it('rejects when the fee exceeds the transfer amount', async () => {
    const [payer, sourceToken, mint, destinationToken] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const elgamalKeypair = new ElGamalKeypair();
    const sourceTokenAccount = {
        extensions: some([{ __kind: 'ConfidentialTransferAccount' }]),
    } as Token;
    const mintAccount = {
        extensions: some([
            {
                __kind: 'TransferFeeConfig',
                olderTransferFee: { epoch: 0n, maximumFee: 1_000n, transferFeeBasisPoints: 20_000 },
                newerTransferFee: { epoch: 0n, maximumFee: 1_000n, transferFeeBasisPoints: 20_000 },
            },
            {
                __kind: 'ConfidentialTransferFee',
                elgamalPubkey: elgamalPubkeyAsAddress(elgamalKeypair),
            },
        ]),
    } as Mint;

    await expect(
        getConfidentialTransferWithFeeInstructionPlan({
            payer,
            rpc: {} as ValidatorClient['rpc'],
            sourceToken: sourceToken.address,
            mint: mint.address,
            destinationToken: destinationToken.address,
            sourceTokenAccount,
            destinationElgamalPubkey: elgamalPubkeyAsAddress(elgamalKeypair),
            mintAccount,
            currentEpoch: 0n,
            authority: payer,
            amount: 1n,
            sourceElgamalKeypair: elgamalKeypair,
            aesKey: new AeKey(),
        }),
    ).rejects.toThrow('Fee exceeds transfer amount.');
});
