import { expect } from 'chai';
import { ExtensionType, getExtensionTypes } from '../../src';

const TYPE_SIZE = 2;
const LENGTH_SIZE = 2;

function extension(entryType: ExtensionType, valueLength: number): Buffer {
    const header = Buffer.alloc(TYPE_SIZE + LENGTH_SIZE);
    header.writeUInt16LE(entryType, 0);
    header.writeUInt16LE(valueLength, TYPE_SIZE);
    return Buffer.concat([header, Buffer.alloc(valueLength)]);
}

describe('getExtensionTypes', () => {
    const metadataPointer = extension(ExtensionType.MetadataPointer, 64);
    const tokenMetadata = extension(ExtensionType.TokenMetadata, 117);

    it('reads each type and length in order', () => {
        expect(getExtensionTypes(Buffer.concat([metadataPointer, tokenMetadata]))).to.deep.equal([
            ExtensionType.MetadataPointer,
            ExtensionType.TokenMetadata,
        ]);
    });

    it('stops at the Uninitialized padding added when an account length equals Multisig::LEN', () => {
        const tlvData = Buffer.concat([metadataPointer, tokenMetadata, Buffer.from([0, 0])]);
        expect(tlvData).to.have.length(191);
        expect(getExtensionTypes(tlvData)).to.deep.equal([ExtensionType.MetadataPointer, ExtensionType.TokenMetadata]);
    });

    it('returns an empty list for empty tlv data', () => {
        expect(getExtensionTypes(Buffer.alloc(0))).to.deep.equal([]);
    });
});
