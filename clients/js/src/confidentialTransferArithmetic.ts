import { ristretto255 } from '@noble/curves/ed25519';
import { type ReadonlyUint8Array } from '@solana/kit';

const { Point: RistrettoPoint } = ristretto255;

// Standard ristretto255 basepoint (Pedersen generator G) — hardcoded to match the on-chain program.
const RISTRETTO_BASEPOINT = RistrettoPoint.fromHex(
    Uint8Array.from([
        226, 242, 174, 10, 106, 188, 78, 113, 168, 132, 169, 97, 197, 0, 81, 95, 88, 227, 11, 106, 165, 130, 221, 141,
        182, 166, 89, 69, 224, 141, 45, 118,
    ]),
);

function pointFromBytes(bytes: ReadonlyUint8Array) {
    return RistrettoPoint.fromHex(new Uint8Array(bytes));
}

function ciphertextToPoints(ciphertext: ReadonlyUint8Array) {
    if (ciphertext.length !== 64) {
        throw new Error(`Expected 64 ciphertext bytes, got ${ciphertext.length}.`);
    }

    return {
        commitment: pointFromBytes(ciphertext.slice(0, 32)),
        handle: pointFromBytes(ciphertext.slice(32, 64)),
    };
}

function pointsToCiphertext(commitment: ReturnType<typeof pointFromBytes>, handle: ReturnType<typeof pointFromBytes>) {
    const ciphertext = new Uint8Array(64);
    ciphertext.set(commitment.toRawBytes(), 0);
    ciphertext.set(handle.toRawBytes(), 32);
    return ciphertext;
}

export function extractCiphertextFromGroupedBytes(groupedCiphertext: ReadonlyUint8Array, handleIndex: number) {
    const start = 32 + handleIndex * 32;
    const end = start + 32;
    if (groupedCiphertext.length < end) {
        throw new Error(`Grouped ciphertext does not contain handle ${handleIndex}.`);
    }

    const ciphertext = new Uint8Array(64);
    ciphertext.set(groupedCiphertext.slice(0, 32), 0);
    ciphertext.set(groupedCiphertext.slice(start, end), 32);
    return ciphertext;
}

function subtractCiphertexts(left: ReadonlyUint8Array, right: ReadonlyUint8Array) {
    const leftPoints = ciphertextToPoints(left);
    const rightPoints = ciphertextToPoints(right);
    return pointsToCiphertext(
        leftPoints.commitment.subtract(rightPoints.commitment),
        leftPoints.handle.subtract(rightPoints.handle),
    );
}

function combineLoHiCiphertexts(ciphertextLo: ReadonlyUint8Array, ciphertextHi: ReadonlyUint8Array, bitLength: bigint) {
    const scale = 1n << bitLength;
    const loPoints = ciphertextToPoints(ciphertextLo);
    const hiPoints = ciphertextToPoints(ciphertextHi);
    return pointsToCiphertext(
        loPoints.commitment.add(hiPoints.commitment.multiply(scale)),
        loPoints.handle.add(hiPoints.handle.multiply(scale)),
    );
}

export function subtractWithLoHiCiphertexts(
    left: ReadonlyUint8Array,
    ciphertextLo: ReadonlyUint8Array,
    ciphertextHi: ReadonlyUint8Array,
    bitLength: bigint,
) {
    return subtractCiphertexts(left, combineLoHiCiphertexts(ciphertextLo, ciphertextHi, bitLength));
}

export function subtractAmountFromCiphertext(ciphertext: ReadonlyUint8Array, amount: bigint) {
    const { commitment, handle } = ciphertextToPoints(ciphertext);
    return pointsToCiphertext(commitment.subtract(RISTRETTO_BASEPOINT.multiply(amount)), handle);
}
