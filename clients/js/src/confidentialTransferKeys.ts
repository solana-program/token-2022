import {
    createSignableMessage,
    getAddressDecoder,
    getAddressEncoder,
    type Address,
    type MessagePartialSigner,
    type ReadonlyUint8Array,
} from '@solana/kit';
import type { ConfidentialTransferZkClient } from './confidentialTransferHelpers';

const EMPTY_BYTES = new Uint8Array();
const ADDRESS_DECODER = getAddressDecoder();
const ADDRESS_ENCODER = getAddressEncoder();

export type DerivedElGamalKeypair = Readonly<{
    elgamalPubkey: Address;
    pubkeyBytes: Uint8Array;
    secretKey: Uint8Array;
}>;

async function signDerivationMessage(signer: MessagePartialSigner, message: Uint8Array): Promise<Uint8Array> {
    const [signatures] = await signer.signMessages([createSignableMessage(message)]);
    const signature = signatures?.[signer.address];
    if (signature == null) {
        throw new Error(`Signer ${signer.address} did not return a signature`);
    }
    return new Uint8Array(signature);
}

function addressSeedFromAddress(seedAddress: Address): Uint8Array {
    return new Uint8Array(ADDRESS_ENCODER.encode(seedAddress));
}

/**
 * Derives an ElGamal keypair from a `MessagePartialSigner` by delegating to
 * the WASM ZK SDK. The signer signs the domain-separated message returned
 * by `zk.ElGamalKeypair.signerMessage(publicSeed)`, and the resulting
 * Ed25519 signature is fed into `zk.ElGamalKeypair.fromSignature` to
 * produce a deterministic keypair.
 *
 * @param signer     - A `MessagePartialSigner` whose `signMessages`
 *                     implementation produces the entropy source.
 * @param zk         - A `ConfidentialTransferZkClient` that provides the
 *                     ZK ElGamal Proof primitives. Pass `@solana/zk-sdk`
 *                     (v0.4.2+) or any equivalent implementation.
 * @param publicSeed - Optional additional seed bytes appended to the
 *                     signing message. Defaults to an empty array, which
 *                     matches the current Solana CLI convention. Prefer
 *                     `deriveElGamalKeypairForAddress` when you want
 *                     account-scoped keys.
 * @returns An object containing `secretKey` (32-byte scalar), `pubkeyBytes`
 *          (32-byte compressed Ristretto point), and `elgamalPubkey`
 *          (base58-encoded 32-byte representation for use with this
 *          package's generated instruction builders).
 */
export async function deriveElGamalKeypair({
    signer,
    zk,
    publicSeed = EMPTY_BYTES,
}: {
    signer: MessagePartialSigner;
    zk: ConfidentialTransferZkClient;
    publicSeed?: ReadonlyUint8Array;
}): Promise<DerivedElGamalKeypair> {
    const message = zk.ElGamalKeypair.signerMessage(new Uint8Array(publicSeed));
    const signature = await signDerivationMessage(signer, message);
    const keypair = zk.ElGamalKeypair.fromSignature(signature);
    const pubkeyBytes = new Uint8Array(keypair.pubkey().toBytes());
    const secretKey = new Uint8Array(keypair.secret().toBytes());
    const elgamalPubkey = ADDRESS_DECODER.decode(pubkeyBytes);
    return { elgamalPubkey, pubkeyBytes, secretKey };
}

/**
 * Derives an ElGamal keypair scoped to an `Address` seed.
 *
 * This is the ergonomic path for confidential token accounts, where the
 * token-account address is typically used as the public seed in Rust.
 */
export async function deriveElGamalKeypairForAddress({
    signer,
    zk,
    seedAddress,
}: {
    signer: MessagePartialSigner;
    zk: ConfidentialTransferZkClient;
    seedAddress: Address;
}): Promise<DerivedElGamalKeypair> {
    return await deriveElGamalKeypair({ signer, zk, publicSeed: addressSeedFromAddress(seedAddress) });
}

/**
 * Derives an AES-128 authenticated-encryption key from a
 * `MessagePartialSigner` by delegating to the WASM ZK SDK. The signer
 * signs the domain-separated message returned by
 * `zk.AeKey.signerMessage(publicSeed)`, and the resulting signature is
 * fed into `zk.AeKey.fromSignature` to produce a deterministic key.
 *
 * @param signer     - A `MessagePartialSigner` whose `signMessages`
 *                     implementation produces the entropy source.
 * @param zk         - A `ConfidentialTransferZkClient` that provides the
 *                     ZK ElGamal Proof primitives.
 * @param publicSeed - Optional additional seed bytes appended to the
 *                     signing message. Defaults to an empty array. Prefer
 *                     `deriveAeKeyForAddress` when you want account-scoped
 *                     keys.
 * @returns A 16-byte AES-128 key.
 */
export async function deriveAeKey({
    signer,
    zk,
    publicSeed = EMPTY_BYTES,
}: {
    signer: MessagePartialSigner;
    zk: ConfidentialTransferZkClient;
    publicSeed?: ReadonlyUint8Array;
}): Promise<Uint8Array> {
    const message = zk.AeKey.signerMessage(new Uint8Array(publicSeed));
    const signature = await signDerivationMessage(signer, message);
    const aeKey = zk.AeKey.fromSignature(signature);
    return new Uint8Array(aeKey.toBytes());
}

/**
 * Derives an AES key scoped to an `Address` seed.
 *
 * This is the ergonomic path for confidential token accounts, where the
 * token-account address is typically used as the public seed in Rust.
 */
export async function deriveAeKeyForAddress({
    signer,
    zk,
    seedAddress,
}: {
    signer: MessagePartialSigner;
    zk: ConfidentialTransferZkClient;
    seedAddress: Address;
}): Promise<Uint8Array> {
    return await deriveAeKey({ signer, zk, publicSeed: addressSeedFromAddress(seedAddress) });
}
