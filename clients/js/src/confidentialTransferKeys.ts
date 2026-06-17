import {
    createSignableMessage,
    getAddressDecoder,
    getAddressEncoder,
    getTupleEncoder,
    type Address,
    type MessagePartialSigner,
    type ReadonlyUint8Array,
} from '@solana/kit';
import { AeKey, ElGamalKeypair } from '@solana/zk-sdk/bundler';
import * as ZkSdk from '@solana/zk-sdk/bundler';

export type DerivedElGamalKeypair = Readonly<{
    elgamalPubkey: Address;
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

type ConfidentialKeysInstance = Readonly<{
    ae(): AeKey;
    elgamal(): ElGamalKeypair;
}>;
type ConfidentialKeysConstructor = Readonly<{
    fromSignature(signature: Uint8Array): ConfidentialKeysInstance;
    signerMessage(publicSeed: Uint8Array): Uint8Array;
}>;
type LegacyAeKeyConstructor = typeof AeKey &
    Readonly<{
        fromSignature?: (signature: Uint8Array) => AeKey;
        signerMessage?: (publicSeed: Uint8Array) => Uint8Array;
    }>;
type LegacyElGamalKeypairConstructor = typeof ElGamalKeypair &
    Readonly<{
        fromSignature?: (signature: Uint8Array) => ElGamalKeypair;
        signerMessage?: (publicSeed: Uint8Array) => Uint8Array;
    }>;

function getConfidentialKeysConstructor(): ConfidentialKeysConstructor | undefined {
    return (ZkSdk as unknown as { ConfidentialKeys?: ConfidentialKeysConstructor }).ConfidentialKeys;
}

function ownerMintSeed(owner: Address, mint: Address): ReadonlyUint8Array {
    return getTupleEncoder([getAddressEncoder(), getAddressEncoder()]).encode([owner, mint]);
}

/**
 * Derives an ElGamal keypair by having the signer sign a domain-separated
 * message and feeding the resulting Ed25519 signature into the WASM ZK SDK.
 */
export async function deriveElGamalKeypair({
    signer,
    publicSeed = new Uint8Array(0),
}: {
    signer: MessagePartialSigner;
    publicSeed?: ReadonlyUint8Array;
}): Promise<DerivedElGamalKeypair> {
    const confidentialKeys = getConfidentialKeysConstructor();
    const legacyElGamal = ElGamalKeypair as LegacyElGamalKeypairConstructor;
    const message =
        confidentialKeys?.signerMessage(new Uint8Array(publicSeed)) ??
        legacyElGamal.signerMessage?.(new Uint8Array(publicSeed));
    if (message == null) {
        throw new Error('The installed @solana/zk-sdk does not expose confidential key derivation.');
    }
    const signature = await signDerivationMessage(signer, message);
    const keypair = confidentialKeys?.fromSignature(signature).elgamal() ?? legacyElGamal.fromSignature?.(signature);
    if (keypair == null) {
        throw new Error('The installed @solana/zk-sdk does not expose ElGamal key derivation.');
    }
    const secretKey = new Uint8Array(keypair.secret().toBytes());
    const elgamalPubkey = getAddressDecoder().decode(new Uint8Array(keypair.pubkey().toBytes()));
    return { elgamalPubkey, secretKey };
}

/**
 * Derives an ElGamal keypair bound to an `(owner, mint)` pair. The seed
 * is `concat(ownerBytes, mintBytes)`, which is stable across token-account
 * close-and-reopen and prevents key reuse across mints.
 */
export async function deriveElGamalKeypairForOwnerMint({
    signer,
    owner,
    mint,
}: {
    signer: MessagePartialSigner;
    owner: Address;
    mint: Address;
}): Promise<DerivedElGamalKeypair> {
    return await deriveElGamalKeypair({ signer, publicSeed: ownerMintSeed(owner, mint) });
}

/**
 * Derives an AES-128 authenticated-encryption key by having the signer
 * sign a domain-separated message and feeding the signature into the
 * WASM ZK SDK.
 */
export async function deriveAeKey({
    signer,
    publicSeed = new Uint8Array(0),
}: {
    signer: MessagePartialSigner;
    publicSeed?: ReadonlyUint8Array;
}): Promise<Uint8Array> {
    const confidentialKeys = getConfidentialKeysConstructor();
    const legacyAeKey = AeKey as LegacyAeKeyConstructor;
    const message =
        confidentialKeys?.signerMessage(new Uint8Array(publicSeed)) ??
        legacyAeKey.signerMessage?.(new Uint8Array(publicSeed));
    if (message == null) {
        throw new Error('The installed @solana/zk-sdk does not expose confidential key derivation.');
    }
    const signature = await signDerivationMessage(signer, message);
    const aeKey = confidentialKeys?.fromSignature(signature).ae() ?? legacyAeKey.fromSignature?.(signature);
    if (aeKey == null) {
        throw new Error('The installed @solana/zk-sdk does not expose AES key derivation.');
    }
    return new Uint8Array(aeKey.toBytes());
}

/**
 * Derives an AES key scoped to an `(owner, mint)` pair.
 *
 * See `deriveElGamalKeypairForOwnerMint` for why this is the right binding
 * for confidential token accounts.
 */
export async function deriveAeKeyForOwnerMint({
    signer,
    owner,
    mint,
}: {
    signer: MessagePartialSigner;
    owner: Address;
    mint: Address;
}): Promise<Uint8Array> {
    return await deriveAeKey({ signer, publicSeed: ownerMintSeed(owner, mint) });
}
