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
    deriveAeKey,
    deriveAeKeyForOwnerMint,
    deriveElGamalKeypair,
    deriveElGamalKeypairForOwnerMint,
} from '../src/confidential';

const ADDRESS_DECODER = getAddressDecoder();
const ADDRESS_ENCODER = getAddressEncoder();

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

it('derives a 32-byte ElGamal secret key and a public key Address', async () => {
    const signer = await generateKeyPairSigner();

    const { elgamalPubkey, secretKey } = await deriveElGamalKeypair({ signer });

    expect(elgamalPubkey).toBeTruthy();
    expect(secretKey.length).toBe(32);
    expect(ADDRESS_ENCODER.encode(elgamalPubkey).length).toBe(32);
});

it('derives a 16-byte AES key', async () => {
    const signer = await generateKeyPairSigner();

    const aeKey = await deriveAeKey({ signer });

    expect(aeKey.length).toBe(16);
});

it('derives deterministic ElGamal keys from the same signer and seed', async () => {
    const signer = await generateKeyPairSigner();
    const publicSeed = new Uint8Array([1, 2, 3, 4]);

    const first = await deriveElGamalKeypair({ signer, publicSeed });
    const second = await deriveElGamalKeypair({ signer, publicSeed });

    expect(first.secretKey).toEqual(second.secretKey);
    expect(first.elgamalPubkey).toBe(second.elgamalPubkey);
});

it('derives deterministic AES keys from the same signer and seed', async () => {
    const signer = await generateKeyPairSigner();
    const publicSeed = new Uint8Array([5, 6, 7, 8]);

    const first = await deriveAeKey({ signer, publicSeed });
    const second = await deriveAeKey({ signer, publicSeed });

    expect(first).toEqual(second);
});

it('derives different ElGamal keys for different seeds', async () => {
    const signer = await generateKeyPairSigner();

    const noSeed = await deriveElGamalKeypair({ signer });
    const withSeed = await deriveElGamalKeypair({ signer, publicSeed: new Uint8Array([1]) });

    expect(noSeed.secretKey).not.toEqual(withSeed.secretKey);
    expect(noSeed.elgamalPubkey).not.toBe(withSeed.elgamalPubkey);
});

it('derives different AES keys for different seeds', async () => {
    const signer = await generateKeyPairSigner();

    const noSeed = await deriveAeKey({ signer });
    const withSeed = await deriveAeKey({ signer, publicSeed: new Uint8Array([1]) });

    expect(noSeed).not.toEqual(withSeed);
});

it('derives different keys for different signers', async () => {
    const [signerA, signerB] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);

    const [elgamalA, elgamalB] = await Promise.all([
        deriveElGamalKeypair({ signer: signerA }),
        deriveElGamalKeypair({ signer: signerB }),
    ]);
    const [aeA, aeB] = await Promise.all([deriveAeKey({ signer: signerA }), deriveAeKey({ signer: signerB })]);

    expect(elgamalA.secretKey).not.toEqual(elgamalB.secretKey);
    expect(aeA).not.toEqual(aeB);
});

it('matches the solana-conf-bal/v1 derivation vector', async () => {
    const signer = await createKeyPairSignerFromPrivateKeyBytes(RUST_VECTOR_PRIVATE_KEY);

    const [derivedElGamal, derivedAeKey] = await Promise.all([
        deriveElGamalKeypair({ signer, publicSeed: RUST_VECTOR_PUBLIC_SEED }),
        deriveAeKey({ signer, publicSeed: RUST_VECTOR_PUBLIC_SEED }),
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
        deriveElGamalKeypairForOwnerMint({ signer, owner, mint }),
        deriveElGamalKeypair({ signer, publicSeed: expectedSeed }),
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
        deriveAeKeyForOwnerMint({ signer, owner, mint }),
        deriveAeKey({ signer, publicSeed: expectedSeed }),
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
        deriveElGamalKeypairForOwnerMint({ signer, owner, mint: mintA.address }),
        deriveElGamalKeypairForOwnerMint({ signer, owner, mint: mintB.address }),
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
        deriveElGamalKeypairForOwnerMint({ signer: signerA, owner: signerA.address, mint }),
        deriveElGamalKeypairForOwnerMint({ signer: signerB, owner: signerB.address, mint }),
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
    const publicSeed = new Uint8Array([9, 8, 7, 6]);

    const [derivedElGamal, expectedElGamal] = await Promise.all([
        deriveElGamalKeypair({ signer: genericSigner, publicSeed }),
        deriveElGamalKeypair({ signer, publicSeed }),
    ]);
    const [derivedAeKey, expectedAeKey] = await Promise.all([
        deriveAeKey({ signer: genericSigner, publicSeed }),
        deriveAeKey({ signer, publicSeed }),
    ]);

    expect(derivedElGamal.secretKey).toEqual(expectedElGamal.secretKey);
    expect(derivedElGamal.elgamalPubkey).toBe(expectedElGamal.elgamalPubkey);
    expect(derivedAeKey).toEqual(expectedAeKey);
});

it('plugs derived ElGamal pubkeys directly into confidential transfer instruction builders', async () => {
    const [authority, mintSigner] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    const derivedElGamal = await deriveElGamalKeypair({ signer: authority });

    const instruction = getInitializeConfidentialTransferMintInstruction({
        mint: mintSigner.address,
        authority: some(authority.address),
        autoApproveNewAccounts: true,
        auditorElgamalPubkey: some(derivedElGamal.elgamalPubkey),
    });
    const parsed = parseInitializeConfidentialTransferMintInstruction(instruction);

    expect(parsed.data.authority).toEqual(some(authority.address));
    expect(parsed.data.autoApproveNewAccounts).toBe(true);
    expect(parsed.data.auditorElgamalPubkey).toEqual(some(derivedElGamal.elgamalPubkey));
});

it('produces a non-zero ElGamal secret key', async () => {
    const signer = await generateKeyPairSigner();

    const { secretKey } = await deriveElGamalKeypair({ signer });

    expect(secretKey.every(b => b === 0)).toBe(false);
});

it('produces a non-zero AES key', async () => {
    const signer = await generateKeyPairSigner();

    const aeKey = await deriveAeKey({ signer });

    expect(aeKey.every(b => b === 0)).toBe(false);
});
