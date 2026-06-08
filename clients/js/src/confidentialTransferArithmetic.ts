// We depend on @noble/curves because the Web Crypto API does not expose
// Ristretto255 point arithmetic, and `@solana/zk-sdk` (the WASM SDK) does
// not currently expose `ElGamalCiphertext` arithmetic (subtract / multiply
// by scalar / lo-hi combination) over its public API. Once the WASM SDK
// adds those methods, delete this file and call into the SDK directly.
import { ristretto255 } from '@noble/curves/ed25519';
import { type ReadonlyUint8Array } from '@solana/kit';

const { Point: RistrettoPoint } = /* @__PURE__ */ ristretto255;

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

/**
 * Extracts a single ElGamal ciphertext (commitment + one handle) from a
 * grouped ciphertext. The grouped layout is: 32-byte commitment followed
 * by N 32-byte handles. The returned 64-byte array is [commitment, handle].
 */
export function extractCiphertextFromGroupedBytes(groupedCiphertext: ReadonlyUint8Array, handleIndex: number) {
    if (!Number.isInteger(handleIndex) || handleIndex < 0) {
        throw new Error(`handleIndex must be a non-negative integer, got ${handleIndex}.`);
    }
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

/**
 * Combines lo/hi ciphertext halves (hi << bitLength + lo) and subtracts the
 * result from `left`. Used to compute the new available-balance ciphertext
 * after a confidential transfer.
 */
export function addWithLoHiCiphertexts(
    left: ReadonlyUint8Array,
    ciphertextLo: ReadonlyUint8Array,
    ciphertextHi: ReadonlyUint8Array,
    bitLength: bigint,
) {
    const leftPoints = ciphertextToPoints(left);
    const rightPoints = ciphertextToPoints(combineLoHiCiphertexts(ciphertextLo, ciphertextHi, bitLength));
    return pointsToCiphertext(
        leftPoints.commitment.add(rightPoints.commitment),
        leftPoints.handle.add(rightPoints.handle),
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

/**
 * Subtracts a plaintext amount from an ElGamal ciphertext by removing
 * `amount * G` from the commitment. Used to compute the expected
 * remaining-balance ciphertext after a confidential withdraw.
 */
export function subtractAmountFromCiphertext(ciphertext: ReadonlyUint8Array, amount: bigint) {
    const { commitment, handle } = ciphertextToPoints(ciphertext);
    return pointsToCiphertext(commitment.subtract(RistrettoPoint.BASE.multiply(amount)), handle);
}
