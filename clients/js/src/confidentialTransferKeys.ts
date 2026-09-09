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

export type DerivedConfidentialKeys = Readonly<{
    aeKey: Uint8Array;
    elgamalKeypair: DerivedElGamalKeypair;
}>;

async function signDerivationMessage(signer: MessagePartialSigner, message: Uint8Array): Promise<Uint8Array> {
    const [signatures] = await signer.signMessages([createSignableMessage(message)]);
    const signature = signatures?.[signer.address];
    if (signature == null) {
        throw new Error(`Signer ${signer.address} did not return a signature`);
    }
    return new Uint8Array(signature);
}

function decodeConfidentialKeys(keys: ConfidentialKeys): DerivedConfidentialKeys {
    const elgamal = keys.elgamal();
    const secretKey = new Uint8Array(elgamal.secret().toBytes());
    const elgamalPubkey = getAddressDecoder().decode(new Uint8Array(elgamal.pubkey().toBytes()));
    const aeKey = new Uint8Array(keys.ae().toBytes());
    return { aeKey, elgamalKeypair: { elgamalPubkey, secretKey } };
}

function ownerMintSeed(owner: Address, mint: Address): ReadonlyUint8Array {
    return getTupleEncoder([getAddressEncoder(), getAddressEncoder()]).encode([owner, mint]);
}

/**
 * The standard confidential-balances key derivation: the signer signs the
 * constant `solana-conf-bal/v1` message exactly once, and both the ElGamal
 * keypair and the AES-128 authenticated-encryption key are derived from that
 * single Ed25519 signature via the WASM ZK SDK.
 *
 * The keys are bound to the wallet alone: one key pair covering all of the
 * wallet's mints and token accounts, byte-identical to what every other
 * standard client (Rust `solana-zk-sdk`, `@solana/zk-sdk`, the CLI, solana-go)
 * derives for the same wallet. There is no seed to pass, so two standard
 * clients cannot accidentally derive different keys.
 *
 * Signing once also guarantees the two keys belong together, even with
 * non-deterministic signers, and costs a single wallet approval.
 *
 * Wallets should expose this signature through a dedicated derivation flow
 * and refuse generic `signMessage` requests starting with
 * `solana-conf-bal/v1`: the signature is the input key material for the
 * wallet's confidential-balance decryption keys.
 */
export async function deriveConfidentialKeys({
    signer,
}: {
    signer: MessagePartialSigner;
}): Promise<DerivedConfidentialKeys> {
    const message = ConfidentialKeys.signerMessage(new Uint8Array(0));
    const signature = await signDerivationMessage(signer, message);
    return decodeConfidentialKeys(ConfidentialKeys.fromSignature(signature));
}

/**
 * Non-standard, seed-scoped derivation of an ElGamal keypair: the signer signs
 * `solana-conf-bal/v1 || publicSeed`.
 *
 * Use this only for schemes that genuinely need keys scoped more finely than
 * the wallet. Keys derived from a non-empty seed will NOT match the standard
 * keys other clients derive for the same wallet; for the standard wallet-level
 * keys use `deriveConfidentialKeys`.
 */
export async function deriveElGamalKeypairWithSeed({
    signer,
    publicSeed,
}: {
    publicSeed: ReadonlyUint8Array;
    signer: MessagePartialSigner;
}): Promise<DerivedElGamalKeypair> {
    const message = ConfidentialKeys.signerMessage(new Uint8Array(publicSeed));
    const signature = await signDerivationMessage(signer, message);
    return decodeConfidentialKeys(ConfidentialKeys.fromSignature(signature)).elgamalKeypair;
}

/**
 * Non-standard, seed-scoped derivation of an AES-128 authenticated-encryption
 * key: the signer signs `solana-conf-bal/v1 || publicSeed`.
 *
 * See `deriveElGamalKeypairWithSeed` for when a seed is appropriate; for the
 * standard wallet-level keys use `deriveConfidentialKeys`.
 */
export async function deriveAeKeyWithSeed({
    signer,
    publicSeed,
}: {
    publicSeed: ReadonlyUint8Array;
    signer: MessagePartialSigner;
}): Promise<Uint8Array> {
    const message = ConfidentialKeys.signerMessage(new Uint8Array(publicSeed));
    const signature = await signDerivationMessage(signer, message);
    return decodeConfidentialKeys(ConfidentialKeys.fromSignature(signature)).aeKey;
}

/**
 * Derives an ElGamal keypair bound to an `(owner, mint)` pair, with a seed of
 * `concat(ownerBytes, mintBytes)`.
 *
 * @deprecated Use `deriveConfidentialKeys({ signer })`, the standard
 * wallet-level derivation. Use this helper only to decrypt and migrate
 * balances on accounts configured with owner-mint keys.
 */
export async function deriveElGamalKeypairForOwnerMint({
    signer,
    owner,
    mint,
}: {
    mint: Address;
    owner: Address;
    signer: MessagePartialSigner;
}): Promise<DerivedElGamalKeypair> {
    return await deriveElGamalKeypairWithSeed({ publicSeed: ownerMintSeed(owner, mint), signer });
}

/**
 * Derives an AES key scoped to an `(owner, mint)` pair.
 *
 * @deprecated Use `deriveConfidentialKeys({ signer })`, the standard
 * wallet-level derivation. Use this helper only to decrypt and migrate
 * balances on accounts configured with owner-mint keys.
 */
export async function deriveAeKeyForOwnerMint({
    signer,
    owner,
    mint,
}: {
    mint: Address;
    owner: Address;
    signer: MessagePartialSigner;
}): Promise<Uint8Array> {
    return await deriveAeKeyWithSeed({ publicSeed: ownerMintSeed(owner, mint), signer });
}
