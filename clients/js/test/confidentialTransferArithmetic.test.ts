import {
    ElGamalCiphertext,
    ElGamalKeypair,
    GroupedElGamalCiphertext3Handles,
    PedersenOpening,
} from '@solana/zk-sdk/node';
import { expect, it } from 'vitest';

import {
    addWithLoHiCiphertexts,
    extractCiphertextFromGroupedBytes,
    subtractWithLoHiCiphertexts,
} from '../src/confidentialTransferArithmetic';

const LO_BIT_LENGTH = 16n;

function splitAmount(amount: bigint, bitLength: bigint): [bigint, bigint] {
    const mask = (1n << bitLength) - 1n;
    return [amount & mask, amount >> bitLength];
}

// Builds the raw bytes of a grouped 3-handle ciphertext of `amount` under
// `[pubkey0, pubkey1, pubkey2]`, the layout the mint/burn helpers encrypt into.
function groupedCiphertextBytes(
    pubkey0: ReturnType<ElGamalKeypair['pubkey']>,
    pubkey1: ReturnType<ElGamalKeypair['pubkey']>,
    pubkey2: ReturnType<ElGamalKeypair['pubkey']>,
    amount: bigint,
): Uint8Array {
    return GroupedElGamalCiphertext3Handles.encryptWith(
        pubkey0,
        pubkey1,
        pubkey2,
        amount,
        new PedersenOpening(),
    ).toBytes();
}

function decrypt(keypair: ElGamalKeypair, ciphertextBytes: Uint8Array): bigint {
    const ciphertext = ElGamalCiphertext.fromBytes(new Uint8Array(ciphertextBytes));
    if (!ciphertext) {
        throw new Error('Failed to decode ciphertext.');
    }
    return keypair.secret().decrypt(ciphertext);
}

// Exercises the exact arithmetic `getConfidentialMintInstructionPlan` performs:
// the amount is grouped-encrypted under [destination, supply, auditor], the
// supply handle (index 1) is combined lo/hi and homomorphically added to the
// mint's current encrypted supply. An amount that straddles the 16-bit boundary
// exercises both the lo and hi halves.
it('addWithLoHiCiphertexts adds the grouped mint amount to the running supply', () => {
    const supply = new ElGamalKeypair();
    const destination = new ElGamalKeypair();
    const auditor = new ElGamalKeypair();

    const currentSupply = 10n;
    const amount = 65541n; // lo = 5, hi = 1
    const [amountLo, amountHi] = splitAmount(amount, LO_BIT_LENGTH);

    const currentSupplyCiphertext = new Uint8Array(supply.pubkey().encryptU64(currentSupply).toBytes());
    const groupedLo = groupedCiphertextBytes(destination.pubkey(), supply.pubkey(), auditor.pubkey(), amountLo);
    const groupedHi = groupedCiphertextBytes(destination.pubkey(), supply.pubkey(), auditor.pubkey(), amountHi);
    const supplyCiphertextLo = extractCiphertextFromGroupedBytes(groupedLo, 1);
    const supplyCiphertextHi = extractCiphertextFromGroupedBytes(groupedHi, 1);

    const newSupplyCiphertext = addWithLoHiCiphertexts(
        currentSupplyCiphertext,
        supplyCiphertextLo,
        supplyCiphertextHi,
        LO_BIT_LENGTH,
    );

    expect(decrypt(supply, newSupplyCiphertext)).toBe(currentSupply + amount);
});

// Exercises the arithmetic `getConfidentialBurnInstructionPlan` performs: the
// amount is grouped-encrypted under [source, supply, auditor], the source handle
// (index 0) is combined lo/hi and homomorphically subtracted from the account's
// available balance.
it('subtractWithLoHiCiphertexts subtracts the grouped burn amount from the balance', () => {
    const source = new ElGamalKeypair();
    const supply = new ElGamalKeypair();
    const auditor = new ElGamalKeypair();

    const currentBalance = 65600n;
    const amount = 65541n; // lo = 5, hi = 1
    const [amountLo, amountHi] = splitAmount(amount, LO_BIT_LENGTH);

    const currentBalanceCiphertext = new Uint8Array(source.pubkey().encryptU64(currentBalance).toBytes());
    const groupedLo = groupedCiphertextBytes(source.pubkey(), supply.pubkey(), auditor.pubkey(), amountLo);
    const groupedHi = groupedCiphertextBytes(source.pubkey(), supply.pubkey(), auditor.pubkey(), amountHi);
    const sourceCiphertextLo = extractCiphertextFromGroupedBytes(groupedLo, 0);
    const sourceCiphertextHi = extractCiphertextFromGroupedBytes(groupedHi, 0);

    const newBalanceCiphertext = subtractWithLoHiCiphertexts(
        currentBalanceCiphertext,
        sourceCiphertextLo,
        sourceCiphertextHi,
        LO_BIT_LENGTH,
    );

    expect(decrypt(source, newBalanceCiphertext)).toBe(currentBalance - amount);
});
