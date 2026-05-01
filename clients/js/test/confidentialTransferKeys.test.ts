import {
    createKeyPairSignerFromPrivateKeyBytes,
    generateKeyPairSigner,
    getAddressDecoder,
    getAddressEncoder,
    some,
    type MessagePartialSigner,
} from '@solana/kit';
import * as zkSdk from '@solana/zk-sdk/node';
import test from 'ava';
import {
    type ConfidentialTransferZkClient,
    deriveAeKey,
    deriveAeKeyForAddress,
    deriveElGamalKeypair,
    deriveElGamalKeypairForAddress,
    getInitializeConfidentialTransferMintInstruction,
    parseInitializeConfidentialTransferMintInstruction,
} from '../src';

const zk = zkSdk as unknown as ConfidentialTransferZkClient;
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
const RUST_VECTOR_PUBLIC_SEED_ADDRESS = ADDRESS_DECODER.decode(RUST_VECTOR_PUBLIC_SEED);
const RUST_VECTOR_ELGAMAL_SECRET_KEY = new Uint8Array([
    241, 57, 101, 25, 81, 46, 182, 190, 48, 67, 70, 212, 112, 100, 196, 151, 81, 38, 121, 14, 125, 101, 91, 57, 182,
    241, 127, 250, 6, 41, 183, 15,
]);
const RUST_VECTOR_ELGAMAL_PUBKEY = new Uint8Array([
    214, 11, 48, 194, 204, 45, 151, 60, 254, 187, 74, 62, 160, 235, 15, 191, 75, 101, 68, 140, 231, 60, 57, 244, 153,
    44, 163, 98, 166, 34, 173, 16,
]);
const RUST_VECTOR_AE_KEY = new Uint8Array([227, 20, 117, 208, 41, 69, 224, 51, 180, 203, 193, 101, 242, 164, 192, 190]);

test('it derives a 32-byte ElGamal secret key and 32-byte public key', async t => {
    const signer = await generateKeyPairSigner();

    const { elgamalPubkey, pubkeyBytes, secretKey } = await deriveElGamalKeypair({ signer, zk });

    t.truthy(elgamalPubkey);
    t.is(secretKey.length, 32);
    t.is(pubkeyBytes.length, 32);
});

test('it derives a 16-byte AES key', async t => {
    const signer = await generateKeyPairSigner();

    const aeKey = await deriveAeKey({ signer, zk });

    t.is(aeKey.length, 16);
});

test('it derives deterministic ElGamal keys from the same signer and seed', async t => {
    const signer = await generateKeyPairSigner();
    const publicSeed = new Uint8Array([1, 2, 3, 4]);

    const first = await deriveElGamalKeypair({ signer, zk, publicSeed });
    const second = await deriveElGamalKeypair({ signer, zk, publicSeed });

    t.deepEqual(first.secretKey, second.secretKey);
    t.deepEqual(first.pubkeyBytes, second.pubkeyBytes);
});

test('it derives deterministic AES keys from the same signer and seed', async t => {
    const signer = await generateKeyPairSigner();
    const publicSeed = new Uint8Array([5, 6, 7, 8]);

    const first = await deriveAeKey({ signer, zk, publicSeed });
    const second = await deriveAeKey({ signer, zk, publicSeed });

    t.deepEqual(first, second);
});

test('it derives different ElGamal keys for different seeds', async t => {
    const signer = await generateKeyPairSigner();

    const noSeed = await deriveElGamalKeypair({ signer, zk });
    const withSeed = await deriveElGamalKeypair({ signer, zk, publicSeed: new Uint8Array([1]) });

    t.notDeepEqual(noSeed.secretKey, withSeed.secretKey);
    t.notDeepEqual(noSeed.pubkeyBytes, withSeed.pubkeyBytes);
});

test('it derives different AES keys for different seeds', async t => {
    const signer = await generateKeyPairSigner();

    const noSeed = await deriveAeKey({ signer, zk });
    const withSeed = await deriveAeKey({ signer, zk, publicSeed: new Uint8Array([1]) });

    t.notDeepEqual(noSeed, withSeed);
});

test('it derives different keys for different signers', async t => {
    const [signerA, signerB] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);

    const [elgamalA, elgamalB] = await Promise.all([
        deriveElGamalKeypair({ signer: signerA, zk }),
        deriveElGamalKeypair({ signer: signerB, zk }),
    ]);
    const [aeA, aeB] = await Promise.all([deriveAeKey({ signer: signerA, zk }), deriveAeKey({ signer: signerB, zk })]);

    t.notDeepEqual(elgamalA.secretKey, elgamalB.secretKey);
    t.notDeepEqual(aeA, aeB);
});

test('it matches the Rust solana-zk-sdk derivation vector', async t => {
    const signer = await createKeyPairSignerFromPrivateKeyBytes(RUST_VECTOR_PRIVATE_KEY);

    const [derivedElGamal, derivedAeKey] = await Promise.all([
        deriveElGamalKeypair({ signer, zk, publicSeed: RUST_VECTOR_PUBLIC_SEED }),
        deriveAeKey({ signer, zk, publicSeed: RUST_VECTOR_PUBLIC_SEED }),
    ]);

    t.deepEqual(derivedElGamal.secretKey, RUST_VECTOR_ELGAMAL_SECRET_KEY);
    t.deepEqual(derivedElGamal.pubkeyBytes, RUST_VECTOR_ELGAMAL_PUBKEY);
    t.is(derivedElGamal.elgamalPubkey, ADDRESS_DECODER.decode(RUST_VECTOR_ELGAMAL_PUBKEY));
    t.deepEqual(derivedAeKey, RUST_VECTOR_AE_KEY);
});

test('it derives the same keys when the public seed is provided as an Address', async t => {
    const signer = await createKeyPairSignerFromPrivateKeyBytes(RUST_VECTOR_PRIVATE_KEY);

    const [derivedElGamal, derivedAeKey, expectedElGamal, expectedAeKey] = await Promise.all([
        deriveElGamalKeypairForAddress({ signer, zk, seedAddress: RUST_VECTOR_PUBLIC_SEED_ADDRESS }),
        deriveAeKeyForAddress({ signer, zk, seedAddress: RUST_VECTOR_PUBLIC_SEED_ADDRESS }),
        deriveElGamalKeypair({ signer, zk, publicSeed: ADDRESS_ENCODER.encode(RUST_VECTOR_PUBLIC_SEED_ADDRESS) }),
        deriveAeKey({ signer, zk, publicSeed: ADDRESS_ENCODER.encode(RUST_VECTOR_PUBLIC_SEED_ADDRESS) }),
    ]);

    t.deepEqual(derivedElGamal.secretKey, expectedElGamal.secretKey);
    t.deepEqual(derivedElGamal.pubkeyBytes, expectedElGamal.pubkeyBytes);
    t.is(derivedElGamal.elgamalPubkey, expectedElGamal.elgamalPubkey);
    t.deepEqual(derivedAeKey, expectedAeKey);
});

test('it derives keys from a generic message signer', async t => {
    const signer = await generateKeyPairSigner();
    const genericSigner: MessagePartialSigner = {
        address: signer.address,
        signMessages: signer.signMessages,
    };
    const publicSeed = new Uint8Array([9, 8, 7, 6]);

    const [derivedElGamal, expectedElGamal] = await Promise.all([
        deriveElGamalKeypair({ signer: genericSigner, zk, publicSeed }),
        deriveElGamalKeypair({ signer, zk, publicSeed }),
    ]);
    const [derivedAeKey, expectedAeKey] = await Promise.all([
        deriveAeKey({ signer: genericSigner, zk, publicSeed }),
        deriveAeKey({ signer, zk, publicSeed }),
    ]);

    t.deepEqual(derivedElGamal.secretKey, expectedElGamal.secretKey);
    t.deepEqual(derivedElGamal.pubkeyBytes, expectedElGamal.pubkeyBytes);
    t.is(derivedElGamal.elgamalPubkey, expectedElGamal.elgamalPubkey);
    t.deepEqual(derivedAeKey, expectedAeKey);
});

test('it plugs derived ElGamal pubkeys directly into confidential transfer instruction builders', async t => {
    const [authority, mint, tokenAccount] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const derivedElGamal = await deriveElGamalKeypairForAddress({
        signer: authority,
        zk,
        seedAddress: tokenAccount.address,
    });

    const instruction = getInitializeConfidentialTransferMintInstruction({
        mint: mint.address,
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

    const { secretKey } = await deriveElGamalKeypair({ signer, zk });

    t.false(secretKey.every(b => b === 0));
});

test('it produces a non-zero AES key', async t => {
    const signer = await generateKeyPairSigner();

    const aeKey = await deriveAeKey({ signer, zk });

    t.false(aeKey.every(b => b === 0));
});
