import {
    createSignableMessage,
    getAddressDecoder,
    getAddressEncoder,
    getTupleEncoder,
    type Address,
    type MessagePartialSigner,
    type ReadonlyUint8Array,
} from '@solana/kit';
import { ConfidentialKeys } from '@solana/zk-sdk/bundler';

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

function ownerMintSeed(owner: Address, mint: Address): ReadonlyUint8Array {
    return getTupleEncoder([getAddressEncoder(), getAddressEncoder()]).encode([owner, mint]);
}

/**
 * Derives an ElGamal keypair following the `solana-conf-bal/v1` standard: the
 * signer signs a domain-separated message and the resulting Ed25519 signature
 * is fed into the WASM ZK SDK's `ConfidentialKeys` to derive the keypair.
 *
 * The standard derivation binds confidential-transfer keys to the main wallet
 * only: leave `publicSeed` at its empty default so one wallet maps to one
 * ElGamal keypair across all mints and token accounts. Only pass a custom
 * seed for non-standard, application-specific keying schemes.
 */
export async function deriveElGamalKeypair({
    signer,
    publicSeed = new Uint8Array(0),
}: {
    signer: MessagePartialSigner;
    publicSeed?: ReadonlyUint8Array;
}): Promise<DerivedElGamalKeypair> {
    const message = ConfidentialKeys.signerMessage(new Uint8Array(publicSeed));
    const signature = await signDerivationMessage(signer, message);
    const keypair = ConfidentialKeys.fromSignature(signature).elgamal();
    const secretKey = new Uint8Array(keypair.secret().toBytes());
    const elgamalPubkey = getAddressDecoder().decode(new Uint8Array(keypair.pubkey().toBytes()));
    return { elgamalPubkey, secretKey };
}

/**
 * Derives an ElGamal keypair bound to an `(owner, mint)` pair, with a seed of
 * `concat(ownerBytes, mintBytes)`.
 *
 * @deprecated The standard derivation binds keys to the main wallet only.
 * Use `deriveElGamalKeypair({ signer })` with the default empty seed instead.
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
 * Derives an AES-128 authenticated-encryption key following the
 * `solana-conf-bal/v1` standard: the signer signs a domain-separated message
 * and the resulting signature is fed into the WASM ZK SDK's `ConfidentialKeys`.
 *
 * The standard derivation binds the key to the main wallet only: leave
 * `publicSeed` at its empty default so one wallet maps to one AES key across
 * all mints and token accounts.
 */
export async function deriveAeKey({
    signer,
    publicSeed = new Uint8Array(0),
}: {
    signer: MessagePartialSigner;
    publicSeed?: ReadonlyUint8Array;
}): Promise<Uint8Array> {
    const message = ConfidentialKeys.signerMessage(new Uint8Array(publicSeed));
    const signature = await signDerivationMessage(signer, message);
    const aeKey = ConfidentialKeys.fromSignature(signature).ae();
    return new Uint8Array(aeKey.toBytes());
}

/**
 * Derives an AES key scoped to an `(owner, mint)` pair.
 *
 * @deprecated The standard derivation binds keys to the main wallet only.
 * Use `deriveAeKey({ signer })` with the default empty seed instead.
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
