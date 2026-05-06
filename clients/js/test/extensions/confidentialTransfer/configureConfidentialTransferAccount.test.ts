import { Account, Address, address, none, some, unwrapOption } from '@solana/kit';
import * as zkSdk from '@solana/zk-sdk/node';
import { AeCiphertext, AeKey, ElGamalKeypair, ElGamalSecretKey, PubkeyValidityProofData } from '@solana/zk-sdk/node';
import test from 'ava';
import {
    type ConfidentialTransferZkClient,
    Token,
    deriveAeKeyForAddress,
    deriveElGamalKeypairForAddress,
    extension,
    fetchToken,
    getApproveConfidentialTransferAccountInstruction,
    getConfigureConfidentialTransferAccountInstruction,
    isExtension,
} from '../../../src';

const zk = zkSdk as unknown as ConfidentialTransferZkClient;
import {
    createDefaultSolanaClient,
    createMint,
    createToken,
    generateKeyPairSignerWithSol,
    sendAndConfirmInstructions,
} from '../../_setup';
import { getVerifyPubkeyValidityInstruction } from '../../_zkProof';

const DEFAULT_MAXIMUM_PENDING_BALANCE_CREDIT_COUNTER = 65_536n;
const PLACEHOLDER_ELGAMAL_PUBKEY = address('11111111111111111111111111111111');

const getConfidentialTransferAccountExtension = (input: {
    approved: boolean;
    decryptableAvailableBalance: Uint8Array;
    elgamalPubkey: Address;
    maximumPendingBalanceCreditCounter?: bigint;
}) =>
    extension('ConfidentialTransferAccount', {
        approved: input.approved,
        elgamalPubkey: input.elgamalPubkey,
        pendingBalanceLow: new Uint8Array(64),
        pendingBalanceHigh: new Uint8Array(64),
        availableBalance: new Uint8Array(64),
        decryptableAvailableBalance: input.decryptableAvailableBalance,
        allowConfidentialCredits: true,
        allowNonConfidentialCredits: true,
        pendingBalanceCreditCounter: 0n,
        maximumPendingBalanceCreditCounter:
            input.maximumPendingBalanceCreditCounter ?? DEFAULT_MAXIMUM_PENDING_BALANCE_CREDIT_COUNTER,
        expectedPendingBalanceCreditCounter: 0n,
        actualPendingBalanceCreditCounter: 0n,
    });

test('it configures and approves a token account for confidential transfer using derived keys', async t => {
    const client = createDefaultSolanaClient();
    const [payer, confidentialTransferAuthority, owner] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSignerWithSol(client),
        generateKeyPairSignerWithSol(client),
    ]);

    const mint = await createMint({
        authority: payer,
        client,
        extensions: [
            extension('ConfidentialTransferMint', {
                authority: some(confidentialTransferAuthority.address),
                autoApproveNewAccounts: false,
                auditorElgamalPubkey: none(),
            }),
        ],
        payer,
    });

    const token = await createToken({
        client,
        extensions: [
            getConfidentialTransferAccountExtension({
                approved: false,
                decryptableAvailableBalance: new Uint8Array(36),
                elgamalPubkey: PLACEHOLDER_ELGAMAL_PUBKEY,
                maximumPendingBalanceCreditCounter: 0n,
            }),
        ],
        mint,
        owner,
        payer,
    });

    const [derivedElGamalKeypair, derivedAeKey] = await Promise.all([
        deriveElGamalKeypairForAddress({ signer: owner, zk, seedAddress: token }),
        deriveAeKeyForAddress({ signer: owner, zk, seedAddress: token }),
    ]);

    const elgamalSecretKey = ElGamalSecretKey.fromBytes(derivedElGamalKeypair.secretKey);
    const elgamalKeypair = ElGamalKeypair.fromSecretKey(elgamalSecretKey);
    const pubkeyValidityProofData = new PubkeyValidityProofData(elgamalKeypair);

    const aeKey = AeKey.fromBytes(derivedAeKey);
    const decryptableZeroBalance = aeKey.encrypt(0n).toBytes();

    await sendAndConfirmInstructions(client, payer, [
        getConfigureConfidentialTransferAccountInstruction({
            token,
            mint,
            authority: owner,
            decryptableZeroBalance,
            maximumPendingBalanceCreditCounter: DEFAULT_MAXIMUM_PENDING_BALANCE_CREDIT_COUNTER,
            proofInstructionOffset: 1,
        }),
        getVerifyPubkeyValidityInstruction(pubkeyValidityProofData),
    ]);

    const configuredTokenAccount = await fetchToken(client.rpc, token);
    const confidentialTransferAccount = unwrapOption(configuredTokenAccount.data.extensions)?.find(extension =>
        isExtension('ConfidentialTransferAccount', extension),
    );
    t.truthy(confidentialTransferAccount);

    if (!confidentialTransferAccount) {
        return;
    }

    t.like(configuredTokenAccount, <Account<Token>>{
        address: token,
        data: {
            owner: owner.address,
            mint,
        },
    });
    t.deepEqual(
        confidentialTransferAccount,
        getConfidentialTransferAccountExtension({
            approved: false,
            decryptableAvailableBalance: decryptableZeroBalance,
            elgamalPubkey: derivedElGamalKeypair.elgamalPubkey,
        }),
    );

    const decryptableCiphertext = AeCiphertext.fromBytes(
        new Uint8Array(confidentialTransferAccount.decryptableAvailableBalance),
    );
    t.truthy(decryptableCiphertext);

    if (!decryptableCiphertext) {
        return;
    }

    t.is(aeKey.decrypt(decryptableCiphertext), 0n);

    await sendAndConfirmInstructions(client, payer, [
        getApproveConfidentialTransferAccountInstruction({
            token,
            mint,
            authority: confidentialTransferAuthority,
        }),
    ]);

    const approvedTokenAccount = await fetchToken(client.rpc, token);
    const approvedConfidentialTransferAccount = unwrapOption(approvedTokenAccount.data.extensions)?.find(extension =>
        isExtension('ConfidentialTransferAccount', extension),
    );
    t.truthy(approvedConfidentialTransferAccount);

    if (!approvedConfidentialTransferAccount) {
        return;
    }

    t.deepEqual(
        approvedConfidentialTransferAccount,
        getConfidentialTransferAccountExtension({
            approved: true,
            decryptableAvailableBalance: decryptableZeroBalance,
            elgamalPubkey: derivedElGamalKeypair.elgamalPubkey,
        }),
    );
});
