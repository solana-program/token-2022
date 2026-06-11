import {
    createKeyPairSignerFromPrivateKeyBytes,
    generateKeyPairSigner,
    getAddressDecoder,
    getAddressEncoder,
    some,
    type MessagePartialSigner,
} from '@solana/kit';
import test from 'ava';
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
    241, 57, 101, 25, 81, 46, 182, 190, 48, 67, 70, 212, 112, 100, 196, 151, 81, 38, 121, 14, 125, 101, 91, 57, 182,
    241, 127, 250, 6, 41, 183, 15,
]);
const RUST_VECTOR_ELGAMAL_PUBKEY = new Uint8Array([
    214, 11, 48, 194, 204, 45, 151, 60, 254, 187, 74, 62, 160, 235, 15, 191, 75, 101, 68, 140, 231, 60, 57, 244, 153,
    44, 163, 98, 166, 34, 173, 16,
]);
const RUST_VECTOR_AE_KEY = new Uint8Array([227, 20, 117, 208, 41, 69, 224, 51, 180, 203, 193, 101, 242, 164, 192, 190]);

test('it derives a 32-byte ElGamal secret key and a public key Address', async t => {
    const signer = await generateKeyPairSigner();

    const { elgamalPubkey, secretKey } = await deriveElGamalKeypair({ signer });

    t.truthy(elgamalPubkey);
    t.is(secretKey.length, 32);
    t.is(ADDRESS_ENCODER.encode(elgamalPubkey).length, 32);
});

test('it derives a 16-byte AES key', async t => {
    const signer = await generateKeyPairSigner();

    const aeKey = await deriveAeKey({ signer });

    t.is(aeKey.length, 16);
});

test('it derives deterministic ElGamal keys from the same signer and seed', async t => {
    const signer = await generateKeyPairSigner();
    const publicSeed = new Uint8Array([1, 2, 3, 4]);

    const first = await deriveElGamalKeypair({ signer, publicSeed });
    const second = await deriveElGamalKeypair({ signer, publicSeed });

    t.deepEqual(first.secretKey, second.secretKey);
    t.is(first.elgamalPubkey, second.elgamalPubkey);
});

test('it derives deterministic AES keys from the same signer and seed', async t => {
    const signer = await generateKeyPairSigner();
    const publicSeed = new Uint8Array([5, 6, 7, 8]);

    const first = await deriveAeKey({ signer, publicSeed });
    const second = await deriveAeKey({ signer, publicSeed });

    t.deepEqual(first, second);
});

test('it derives different ElGamal keys for different seeds', async t => {
    const signer = await generateKeyPairSigner();

    const noSeed = await deriveElGamalKeypair({ signer });
    const withSeed = await deriveElGamalKeypair({ signer, publicSeed: new Uint8Array([1]) });

    t.notDeepEqual(noSeed.secretKey, withSeed.secretKey);
    t.not(noSeed.elgamalPubkey, withSeed.elgamalPubkey);
});

test('it derives different AES keys for different seeds', async t => {
    const signer = await generateKeyPairSigner();

    const noSeed = await deriveAeKey({ signer });
    const withSeed = await deriveAeKey({ signer, publicSeed: new Uint8Array([1]) });

    t.notDeepEqual(noSeed, withSeed);
});

test('it derives different keys for different signers', async t => {
    const [signerA, signerB] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);

    const [elgamalA, elgamalB] = await Promise.all([
        deriveElGamalKeypair({ signer: signerA }),
        deriveElGamalKeypair({ signer: signerB }),
    ]);
    const [aeA, aeB] = await Promise.all([deriveAeKey({ signer: signerA }), deriveAeKey({ signer: signerB })]);

    t.notDeepEqual(elgamalA.secretKey, elgamalB.secretKey);
    t.notDeepEqual(aeA, aeB);
});

test('it matches the Rust solana-zk-sdk derivation vector', async t => {
    const signer = await createKeyPairSignerFromPrivateKeyBytes(RUST_VECTOR_PRIVATE_KEY);

    const [derivedElGamal, derivedAeKey] = await Promise.all([
        deriveElGamalKeypair({ signer, publicSeed: RUST_VECTOR_PUBLIC_SEED }),
        deriveAeKey({ signer, publicSeed: RUST_VECTOR_PUBLIC_SEED }),
    ]);

    t.deepEqual(derivedElGamal.secretKey, RUST_VECTOR_ELGAMAL_SECRET_KEY);
    t.is(derivedElGamal.elgamalPubkey, ADDRESS_DECODER.decode(RUST_VECTOR_ELGAMAL_PUBKEY));
    t.deepEqual(derivedAeKey, RUST_VECTOR_AE_KEY);
});

test('deriveElGamalKeypairForOwnerMint composes the seed as concat(owner, mint)', async t => {
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

    t.deepEqual(convenience.secretKey, manual.secretKey);
    t.is(convenience.elgamalPubkey, manual.elgamalPubkey);
});

test('deriveAeKeyForOwnerMint composes the seed as concat(owner, mint)', async t => {
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

    t.deepEqual(convenience, manual);
});

test('deriveElGamalKeypairForOwnerMint binds keys to (owner, mint), not just owner', async t => {
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
    t.notDeepEqual(keysForMintA.secretKey, keysForMintB.secretKey);
    t.not(keysForMintA.elgamalPubkey, keysForMintB.elgamalPubkey);
});

test('deriveElGamalKeypairForOwnerMint binds keys to (owner, mint), not just mint', async t => {
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
    t.notDeepEqual(keysForOwnerA.secretKey, keysForOwnerB.secretKey);
    t.not(keysForOwnerA.elgamalPubkey, keysForOwnerB.elgamalPubkey);
});

test('it derives keys from a generic message signer', async t => {
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

    t.deepEqual(derivedElGamal.secretKey, expectedElGamal.secretKey);
    t.is(derivedElGamal.elgamalPubkey, expectedElGamal.elgamalPubkey);
    t.deepEqual(derivedAeKey, expectedAeKey);
});

test('it plugs derived ElGamal pubkeys directly into confidential transfer instruction builders', async t => {
    const [authority, mintSigner] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    const derivedElGamal = await deriveElGamalKeypairForOwnerMint({
        signer: authority,
        owner: authority.address,
        mint: mintSigner.address,
    });

    const instruction = getInitializeConfidentialTransferMintInstruction({
        mint: mintSigner.address,
        authority: some(authority.address),
        autoApproveNewAccounts: true,
        auditorElgamalPubkey: some(derivedElGamal.elgamalPubkey),
    });
    const parsed = parseInitializeConfidentialTransferMintInstruction(instruction);

    t.deepEqual(parsed.data.authority, some(authority.address));
    t.true(parsed.data.autoApproveNewAccounts);
    t.deepEqual(parsed.data.auditorElgamalPubkey, some(derivedElGamal.elgamalPubkey));
});

test('it produces a non-zero ElGamal secret key', async t => {
    const signer = await generateKeyPairSigner();

    const { secretKey } = await deriveElGamalKeypair({ signer });

    t.false(secretKey.every(b => b === 0));
});

test('it produces a non-zero AES key', async t => {
    const signer = await generateKeyPairSigner();

    const aeKey = await deriveAeKey({ signer });

    t.false(aeKey.every(b => b === 0));
});
