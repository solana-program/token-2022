import {
    createKeyPairSignerFromPrivateKeyBytes,
    generateKeyPairSigner,
    getAddressDecoder,
    getAddressEncoder,
    some,
    type MessagePartialSigner,
} from '@solana/kit';
import { expect, it, test } from 'vitest';

import {
    getInitializeConfidentialTransferMintInstruction,
    parseInitializeConfidentialTransferMintInstruction,
} from '../src';
import {
    deriveAeKeyForOwnerMint,
    deriveAeKeyWithSeed,
    deriveConfidentialKeys,
    deriveElGamalKeypairForOwnerMint,
    deriveElGamalKeypairWithSeed,
} from '../src/confidential';

const ADDRESS_DECODER = getAddressDecoder();
const ADDRESS_ENCODER = getAddressEncoder();

// Canonical cross-SDK vector for the standard (wallet-level, no seed) path.
// The same inputs and outputs are pinned in the solana-zk-sdk Rust tests and
// the solana-go fixtures (kdf_vectors.json, keypair_a_empty_seed).
const STANDARD_VECTOR_PRIVATE_KEY = new Uint8Array([
    0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00, 0x11, 0x22, 0x33,
    0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00,
]);
const STANDARD_VECTOR_ELGAMAL_SECRET_KEY = new Uint8Array([
    0xbe, 0x5c, 0xce, 0x95, 0x1f, 0x42, 0xa2, 0xa8, 0x67, 0x7d, 0x1a, 0x56, 0xf0, 0x3a, 0xae, 0x7b, 0xff, 0x79, 0x5b,
    0x38, 0xcf, 0x1c, 0x56, 0xc8, 0xcf, 0x3a, 0x4d, 0xae, 0x7d, 0x60, 0xe2, 0x05,
]);
const STANDARD_VECTOR_AE_KEY = new Uint8Array([
    0x64, 0x17, 0xee, 0xdb, 0xcb, 0xe9, 0xc6, 0x4a, 0x72, 0x39, 0x57, 0x19, 0xec, 0x98, 0xcf, 0x6b,
]);

// Vector for the non-standard seeded path.
const RUST_VECTOR_PRIVATE_KEY = new Uint8Array([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
    32,
]);
const RUST_VECTOR_PUBLIC_SEED = new Uint8Array([
    32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2,
    1,
]);
const RUST_VECTOR_ELGAMAL_SECRET_KEY = new Uint8Array([
    148, 147, 19, 10, 117, 168, 174, 32, 148, 35, 232, 108, 225, 144, 210, 91, 130, 229, 59, 231, 81, 116, 192, 231, 21,
    212, 43, 72, 179, 254, 237, 11,
]);
const RUST_VECTOR_ELGAMAL_PUBKEY = new Uint8Array([
    58, 106, 251, 3, 220, 178, 230, 94, 18, 53, 78, 182, 197, 128, 78, 222, 154, 202, 127, 181, 84, 63, 174, 230, 34,
    170, 249, 12, 225, 217, 217, 102,
]);
const RUST_VECTOR_AE_KEY = new Uint8Array([160, 210, 197, 15, 158, 3, 217, 111, 220, 216, 102, 104, 164, 25, 214, 183]);

it('derives a 32-byte ElGamal secret key, a public key Address and a 16-byte AES key', async () => {
    const signer = await generateKeyPairSigner();

    const { aeKey, elgamalKeypair } = await deriveConfidentialKeys({ signer });

    expect(elgamalKeypair.elgamalPubkey).toBeTruthy();
    expect(elgamalKeypair.secretKey.length).toBe(32);
    expect(ADDRESS_ENCODER.encode(elgamalKeypair.elgamalPubkey).length).toBe(32);
    expect(aeKey.length).toBe(16);
});

it('derives deterministic keys from the same signer', async () => {
    const signer = await generateKeyPairSigner();

    const first = await deriveConfidentialKeys({ signer });
    const second = await deriveConfidentialKeys({ signer });

    expect(first.elgamalKeypair.secretKey).toEqual(second.elgamalKeypair.secretKey);
    expect(first.elgamalKeypair.elgamalPubkey).toBe(second.elgamalKeypair.elgamalPubkey);
    expect(first.aeKey).toEqual(second.aeKey);
});

it('signs exactly once for both keys', async () => {
    const signer = await generateKeyPairSigner();
    let signCalls = 0;
    const countingSigner: MessagePartialSigner = {
        address: signer.address,
        signMessages: messages => {
            signCalls += messages.length;
            return signer.signMessages(messages);
        },
    };

    await deriveConfidentialKeys({ signer: countingSigner });

    expect(signCalls).toBe(1);
});

it('derives deterministic seeded ElGamal keys from the same signer and seed', async () => {
    const signer = await generateKeyPairSigner();
    const publicSeed = new Uint8Array([1, 2, 3, 4]);

    const first = await deriveElGamalKeypairWithSeed({ publicSeed, signer });
    const second = await deriveElGamalKeypairWithSeed({ publicSeed, signer });

    expect(first.secretKey).toEqual(second.secretKey);
    expect(first.elgamalPubkey).toBe(second.elgamalPubkey);
});

it('derives deterministic seeded AES keys from the same signer and seed', async () => {
    const signer = await generateKeyPairSigner();
    const publicSeed = new Uint8Array([5, 6, 7, 8]);

    const first = await deriveAeKeyWithSeed({ publicSeed, signer });
    const second = await deriveAeKeyWithSeed({ publicSeed, signer });

    expect(first).toEqual(second);
});

it('matches the standard path when the seed is empty', async () => {
    const signer = await generateKeyPairSigner();

    const standard = await deriveConfidentialKeys({ signer });
    const [elgamalEmptySeed, aeEmptySeed] = await Promise.all([
        deriveElGamalKeypairWithSeed({ publicSeed: new Uint8Array(0), signer }),
        deriveAeKeyWithSeed({ publicSeed: new Uint8Array(0), signer }),
    ]);

    expect(standard.elgamalKeypair.secretKey).toEqual(elgamalEmptySeed.secretKey);
    expect(standard.elgamalKeypair.elgamalPubkey).toBe(elgamalEmptySeed.elgamalPubkey);
    expect(standard.aeKey).toEqual(aeEmptySeed);
});

it('derives different keys for non-empty seeds', async () => {
    const signer = await generateKeyPairSigner();

    const standard = await deriveConfidentialKeys({ signer });
    const [elgamalSeeded, aeSeeded] = await Promise.all([
        deriveElGamalKeypairWithSeed({ publicSeed: new Uint8Array([1]), signer }),
        deriveAeKeyWithSeed({ publicSeed: new Uint8Array([1]), signer }),
    ]);

    expect(standard.elgamalKeypair.secretKey).not.toEqual(elgamalSeeded.secretKey);
    expect(standard.elgamalKeypair.elgamalPubkey).not.toBe(elgamalSeeded.elgamalPubkey);
    expect(standard.aeKey).not.toEqual(aeSeeded);
});

it('derives different keys for different signers', async () => {
    const [signerA, signerB] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);

    const [keysA, keysB] = await Promise.all([
        deriveConfidentialKeys({ signer: signerA }),
        deriveConfidentialKeys({ signer: signerB }),
    ]);

    expect(keysA.elgamalKeypair.secretKey).not.toEqual(keysB.elgamalKeypair.secretKey);
    expect(keysA.aeKey).not.toEqual(keysB.aeKey);
});

it('matches the standard cross-SDK derivation vector', async () => {
    const signer = await createKeyPairSignerFromPrivateKeyBytes(STANDARD_VECTOR_PRIVATE_KEY);

    const { aeKey, elgamalKeypair } = await deriveConfidentialKeys({ signer });

    expect(elgamalKeypair.secretKey).toEqual(STANDARD_VECTOR_ELGAMAL_SECRET_KEY);
    expect(aeKey).toEqual(STANDARD_VECTOR_AE_KEY);
});

it('matches the solana-conf-bal/v1 seeded derivation vector', async () => {
    const signer = await createKeyPairSignerFromPrivateKeyBytes(RUST_VECTOR_PRIVATE_KEY);

    const [derivedElGamal, derivedAeKey] = await Promise.all([
        deriveElGamalKeypairWithSeed({ publicSeed: RUST_VECTOR_PUBLIC_SEED, signer }),
        deriveAeKeyWithSeed({ publicSeed: RUST_VECTOR_PUBLIC_SEED, signer }),
    ]);

    expect(derivedElGamal.secretKey).toEqual(RUST_VECTOR_ELGAMAL_SECRET_KEY);
    expect(derivedElGamal.elgamalPubkey).toBe(ADDRESS_DECODER.decode(RUST_VECTOR_ELGAMAL_PUBKEY));
    expect(derivedAeKey).toEqual(RUST_VECTOR_AE_KEY);
});

test('deriveElGamalKeypairForOwnerMint composes the seed as concat(owner, mint)', async () => {
    const [signer, ownerSigner, mintSigner] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const owner = ownerSigner.address;
    const mint = mintSigner.address;

    const expectedSeed = new Uint8Array(64);
    expectedSeed.set(ADDRESS_ENCODER.encode(owner), 0);
    expectedSeed.set(ADDRESS_ENCODER.encode(mint), 32);

    const [convenience, manual] = await Promise.all([
        deriveElGamalKeypairForOwnerMint({ mint, owner, signer }),
        deriveElGamalKeypairWithSeed({ publicSeed: expectedSeed, signer }),
    ]);

    expect(convenience.secretKey).toEqual(manual.secretKey);
    expect(convenience.elgamalPubkey).toBe(manual.elgamalPubkey);
});

test('deriveAeKeyForOwnerMint composes the seed as concat(owner, mint)', async () => {
    const [signer, ownerSigner, mintSigner] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const owner = ownerSigner.address;
    const mint = mintSigner.address;

    const expectedSeed = new Uint8Array(64);
    expectedSeed.set(ADDRESS_ENCODER.encode(owner), 0);
    expectedSeed.set(ADDRESS_ENCODER.encode(mint), 32);

    const [convenience, manual] = await Promise.all([
        deriveAeKeyForOwnerMint({ mint, owner, signer }),
        deriveAeKeyWithSeed({ publicSeed: expectedSeed, signer }),
    ]);

    expect(convenience).toEqual(manual);
});

test('deriveElGamalKeypairForOwnerMint binds keys to (owner, mint), not just owner', async () => {
    const [signer, mintA, mintB] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const owner = signer.address;

    const [keysForMintA, keysForMintB] = await Promise.all([
        deriveElGamalKeypairForOwnerMint({ mint: mintA.address, owner, signer }),
        deriveElGamalKeypairForOwnerMint({ mint: mintB.address, owner, signer }),
    ]);

    // Different mints with the same owner must yield different keys.
    expect(keysForMintA.secretKey).not.toEqual(keysForMintB.secretKey);
    expect(keysForMintA.elgamalPubkey).not.toBe(keysForMintB.elgamalPubkey);
});

test('deriveElGamalKeypairForOwnerMint binds keys to (owner, mint), not just mint', async () => {
    const [signerA, signerB, mintSigner] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const mint = mintSigner.address;

    const [keysForOwnerA, keysForOwnerB] = await Promise.all([
        deriveElGamalKeypairForOwnerMint({ mint, owner: signerA.address, signer: signerA }),
        deriveElGamalKeypairForOwnerMint({ mint, owner: signerB.address, signer: signerB }),
    ]);

    // Different owners with the same mint must yield different keys.
    expect(keysForOwnerA.secretKey).not.toEqual(keysForOwnerB.secretKey);
    expect(keysForOwnerA.elgamalPubkey).not.toBe(keysForOwnerB.elgamalPubkey);
});

it('derives keys from a generic message signer', async () => {
    const signer = await generateKeyPairSigner();
    const genericSigner: MessagePartialSigner = {
        address: signer.address,
        signMessages: signer.signMessages,
    };

    const [derived, expected] = await Promise.all([
        deriveConfidentialKeys({ signer: genericSigner }),
        deriveConfidentialKeys({ signer }),
    ]);

    expect(derived.elgamalKeypair.secretKey).toEqual(expected.elgamalKeypair.secretKey);
    expect(derived.elgamalKeypair.elgamalPubkey).toBe(expected.elgamalKeypair.elgamalPubkey);
    expect(derived.aeKey).toEqual(expected.aeKey);
});

it('plugs derived ElGamal pubkeys directly into confidential transfer instruction builders', async () => {
    const [authority, mintSigner] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    const { elgamalKeypair } = await deriveConfidentialKeys({ signer: authority });

    const instruction = getInitializeConfidentialTransferMintInstruction({
        mint: mintSigner.address,
        authority: some(authority.address),
        autoApproveNewAccounts: true,
        auditorElgamalPubkey: some(elgamalKeypair.elgamalPubkey),
    });
    const parsed = parseInitializeConfidentialTransferMintInstruction(instruction);

    expect(parsed.data.authority).toEqual(some(authority.address));
    expect(parsed.data.autoApproveNewAccounts).toBe(true);
    expect(parsed.data.auditorElgamalPubkey).toEqual(some(elgamalKeypair.elgamalPubkey));
});

it('produces non-zero keys', async () => {
    const signer = await generateKeyPairSigner();

    const { aeKey, elgamalKeypair } = await deriveConfidentialKeys({ signer });

    expect(elgamalKeypair.secretKey.every(b => b === 0)).toBe(false);
    expect(aeKey.every(b => b === 0)).toBe(false);
});
