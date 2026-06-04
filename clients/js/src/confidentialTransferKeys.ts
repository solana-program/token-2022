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
    const message = ElGamalKeypair.signerMessage(new Uint8Array(publicSeed));
    const signature = await signDerivationMessage(signer, message);
    const keypair = ElGamalKeypair.fromSignature(signature);
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
    const message = AeKey.signerMessage(new Uint8Array(publicSeed));
    const signature = await signDerivationMessage(signer, message);
    const aeKey = AeKey.fromSignature(signature);
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
