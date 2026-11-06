import { PublicKey } from '@solana/web3.js';
import { expect } from 'chai';
import { pack } from '@solana/spl-token-metadata';
import type { Mint } from '../../src';
import {
    ExtensionType,
    getAccountLenForMint,
    getExtensionTypes,
    getMintLen,
    MULTISIG_SIZE,
    TYPE_SIZE,
} from '../../src';

describe('extension type parsing', () => {
    const metadata = Buffer.from(
        pack({
            updateAuthority: PublicKey.default,
            mint: PublicKey.default,
            name: 'Padded mint',
            symbol: 'PAD',
            uri: 'https://example.com/abc',
            additionalMetadata: [],
        }),
    );
    const metadataHeader = Buffer.alloc(4);
    metadataHeader.writeUInt16LE(ExtensionType.TokenMetadata, 0);
    metadataHeader.writeUInt16LE(metadata.length, TYPE_SIZE);
    const tlvData = Buffer.concat([
        Buffer.from([ExtensionType.MetadataPointer, 0, 64, 0]),
        Buffer.alloc(64),
        metadataHeader,
        metadata,
    ]);
    const expectedTypes = [ExtensionType.MetadataPointer, ExtensionType.TokenMetadata];

    it('reads initialized extensions without padding', () => {
        expect(getExtensionTypes(tlvData)).to.deep.equal(expectedTypes);
    });

    it('returns no extensions for empty data', () => {
        expect(getExtensionTypes(Buffer.alloc(0))).to.deep.equal([]);
    });

    it('reads initialized extensions with an empty value', () => {
        const nonTransferable = Buffer.from([ExtensionType.NonTransferable, 0, 0, 0]);
        expect(getExtensionTypes(Buffer.concat([nonTransferable, tlvData, Buffer.alloc(TYPE_SIZE)]))).to.deep.equal([
            ExtensionType.NonTransferable,
            ...expectedTypes,
        ]);
    });

    for (const paddingLength of [2, 3, 4, 8]) {
        it(`stops at uninitialized data with ${paddingLength} remaining bytes`, () => {
            expect(getExtensionTypes(Buffer.alloc(paddingLength))).to.deep.equal([]);
            expect(getExtensionTypes(Buffer.concat([tlvData, Buffer.alloc(paddingLength)]))).to.deep.equal(
                expectedTypes,
            );
        });
    }

    it('ignores bytes after an uninitialized extension', () => {
        expect(getExtensionTypes(Buffer.concat([tlvData, Buffer.alloc(TYPE_SIZE), tlvData]))).to.deep.equal(
            expectedTypes,
        );
    });

    it('ignores a final byte that cannot hold an extension type', () => {
        expect(getExtensionTypes(Buffer.from([1]))).to.deep.equal([]);
        expect(getExtensionTypes(Buffer.concat([tlvData, Buffer.from([1])]))).to.deep.equal(expectedTypes);
    });

    it('still rejects an initialized extension with a truncated length', () => {
        for (const header of [
            Buffer.from([ExtensionType.TokenMetadata, 0]),
            Buffer.from([ExtensionType.TokenMetadata, 0, 1]),
        ]) {
            expect(() => getExtensionTypes(Buffer.concat([tlvData, header]))).to.throw(RangeError);
        }
    });

    it('calculates token account space for a mint padded to avoid the multisig size', () => {
        expect(
            getMintLen([ExtensionType.MetadataPointer], { [ExtensionType.TokenMetadata]: metadata.length }),
        ).to.equal(MULTISIG_SIZE + TYPE_SIZE);
        const mint: Mint = {
            address: PublicKey.default,
            mintAuthority: null,
            supply: 0n,
            decimals: 9,
            isInitialized: true,
            freezeAuthority: null,
            tlvData,
        };
        expect(getAccountLenForMint({ ...mint, tlvData: Buffer.concat([tlvData, Buffer.alloc(TYPE_SIZE)]) })).to.equal(
            getAccountLenForMint(mint),
        );
    });
});
