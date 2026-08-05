import {
    Address,
    TransactionSigner,
    generateKeyPairSigner,
    getAddressDecoder,
    none,
    some,
    type ReadonlyUint8Array,
} from '@solana/kit';
import { AeCiphertext, AeKey, ElGamalCiphertext, ElGamalKeypair } from '@solana/zk-sdk/bundler';
import { expect, it } from 'vitest';

import { ExtensionArgs, Mint, Token, extension, fetchMint, fetchToken } from '../../../src';
import { getConfidentialTransferWithFeeInstructionPlan } from '../../../src/confidential';
import {
    createConfidentialTokenAccount,
    createConfidentialTokenAccountWithBalance,
    createValidatorClient,
    generateKeyPairSignerWithSol,
    getTokenExtension,
    type ValidatorClient,
} from '../../_setup';

function elgamalPubkeyAsAddress(keypair: ElGamalKeypair): Address {
    return getAddressDecoder().decode(new Uint8Array(keypair.pubkey().toBytes()));
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
            auditorElgamalPubkey: none(),
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
    const { mint, mintAuthority, withdrawWithheldAuthorityElGamalKeypair } = await createConfidentialTransferFeeMint({
        client,
        payer,
        decimals,
        maximumFee: input.maximumFee,
        transferFeeBasisPoints: input.transferFeeBasisPoints,
    });
    const source = await createConfidentialTokenAccountWithBalance({
        client,
        payer,
        owner: sourceOwner,
        mint,
        mintAuthority,
        decimals,
        amount: input.initialSourceAmount,
        includeConfidentialTransferFeeAmount: true,
    });
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
    await client.sendTransactions(
        await getConfidentialTransferWithFeeInstructionPlan({
            payer,
            rpc: client.rpc,
            sourceToken: source.token,
            mint,
            destinationToken: destination.token,
            sourceTokenAccount,
            destinationTokenAccount,
            mintAccount,
            currentEpoch: epochInfo.epoch,
            authority: sourceOwner,
            amount: input.amount,
            sourceElgamalKeypair: source.elgamalKeypair,
            aesKey: source.aesKey,
        }),
    );

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
