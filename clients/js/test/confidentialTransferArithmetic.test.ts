import {
    ElGamalCiphertext,
    ElGamalKeypair,
    GroupedElGamalCiphertext3Handles,
    PedersenOpening,
} from '@solana/zk-sdk/node';
import { expect, it } from 'vitest';

const LO_BIT_LENGTH = 16n;

function splitAmount(amount: bigint, bitLength: bigint): [bigint, bigint] {
    const mask = (1n << bitLength) - 1n;
    return [amount & mask, amount >> bitLength];
}

// Builds a grouped 3-handle ciphertext of `amount` under
// `[pubkey0, pubkey1, pubkey2]`, the layout the mint/burn helpers encrypt into.
function groupedCiphertext(
    pubkey0: ReturnType<ElGamalKeypair['pubkey']>,
    pubkey1: ReturnType<ElGamalKeypair['pubkey']>,
    pubkey2: ReturnType<ElGamalKeypair['pubkey']>,
    amount: bigint,
): GroupedElGamalCiphertext3Handles {
    return GroupedElGamalCiphertext3Handles.encryptWith(pubkey0, pubkey1, pubkey2, amount, new PedersenOpening());
}

// Exercises the exact arithmetic `getConfidentialMintInstructionPlan` performs:
// the amount is grouped-encrypted under [destination, supply, auditor], the
// supply handle (index 1) is combined lo/hi and homomorphically added to the
// mint's current encrypted supply. An amount that straddles the 16-bit boundary
// exercises both the lo and hi halves.
it('adds the combined lo/hi grouped mint amount to the running supply', () => {
    const supply = new ElGamalKeypair();
    const destination = new ElGamalKeypair();
    const auditor = new ElGamalKeypair();

    const currentSupply = 10n;
    const amount = 65541n; // lo = 5, hi = 1
    const [amountLo, amountHi] = splitAmount(amount, LO_BIT_LENGTH);

    const currentSupplyCiphertext = supply.pubkey().encryptU64(currentSupply);
    const groupedLo = groupedCiphertext(destination.pubkey(), supply.pubkey(), auditor.pubkey(), amountLo);
    const groupedHi = groupedCiphertext(destination.pubkey(), supply.pubkey(), auditor.pubkey(), amountHi);

    const newSupplyCiphertext = currentSupplyCiphertext.add(
        ElGamalCiphertext.combineLoHi(
            groupedLo.toElGamalCiphertext(1),
            groupedHi.toElGamalCiphertext(1),
            Number(LO_BIT_LENGTH),
        ),
    );

    expect(supply.secret().decrypt(newSupplyCiphertext)).toBe(currentSupply + amount);
});

// Exercises the arithmetic `getConfidentialBurnInstructionPlan` performs: the
// amount is grouped-encrypted under [source, supply, auditor], the source handle
// (index 0) is combined lo/hi and homomorphically subtracted from the account's
// available balance.
it('subtracts the combined lo/hi grouped burn amount from the balance', () => {
    const source = new ElGamalKeypair();
    const supply = new ElGamalKeypair();
    const auditor = new ElGamalKeypair();

    const currentBalance = 65600n;
    const amount = 65541n; // lo = 5, hi = 1
    const [amountLo, amountHi] = splitAmount(amount, LO_BIT_LENGTH);

    const currentBalanceCiphertext = source.pubkey().encryptU64(currentBalance);
    const groupedLo = groupedCiphertext(source.pubkey(), supply.pubkey(), auditor.pubkey(), amountLo);
    const groupedHi = groupedCiphertext(source.pubkey(), supply.pubkey(), auditor.pubkey(), amountHi);

    const newBalanceCiphertext = currentBalanceCiphertext.subtract(
        ElGamalCiphertext.combineLoHi(
            groupedLo.toElGamalCiphertext(0),
            groupedHi.toElGamalCiphertext(0),
            Number(LO_BIT_LENGTH),
        ),
    );

    expect(source.secret().decrypt(newBalanceCiphertext)).toBe(currentBalance - amount);
});
