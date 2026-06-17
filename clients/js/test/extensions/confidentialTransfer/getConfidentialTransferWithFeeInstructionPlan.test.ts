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

import { ExtensionArgs, Token, extension, fetchMint, fetchToken } from '../../../src';
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

it('transfers tokens confidentially with fees', async () => {
    // Given a confidential-transfer-fee mint, a funded source account, and an empty destination account.
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
        maximumFee: 1_000_000_000n,
        transferFeeBasisPoints: 150,
    });
    const source = await createConfidentialTokenAccountWithBalance({
        client,
        payer,
        owner: sourceOwner,
        mint,
        mintAuthority,
        decimals,
        amount: 1000n,
        includeConfidentialTransferFeeAmount: true,
    });
    const destination = await createConfidentialTokenAccount({
        client,
        payer,
        owner: destinationOwner,
        mint,
        includeConfidentialTransferFeeAmount: true,
    });

    // When the source confidentially transfers 2.00 tokens with a 1.5% fee.
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
            amount: 200n,
            sourceElgamalKeypair: source.elgamalKeypair,
            aesKey: source.aesKey,
        }),
    );

    // Then the source is debited by the gross amount, the destination receives the net amount,
    // and the confidential fee amount is withheld on the destination account.
    const [{ data: updatedSource }, { data: updatedDestination }] = await Promise.all([
        fetchToken(client.rpc, source.token),
        fetchToken(client.rpc, destination.token),
    ]);
    expect(decryptAvailableBalance(updatedSource, source.aesKey)).toBe(800n);
    expect(decryptPendingBalance(updatedDestination, destination.elgamalKeypair)).toBe(197n);
    expect(decryptWithheldAmount(updatedDestination, withdrawWithheldAuthorityElGamalKeypair)).toBe(3n);
    expect(getTokenExtension(updatedDestination, 'ConfidentialTransferAccount').pendingBalanceCreditCounter).toBe(1n);
});
