import { PublicKey } from '@solana/web3.js';
import { expect } from 'chai';
import { bool, publicKey, u64 } from '../../src/layouts';

describe('layouts', () => {
    describe('u64', () => {
        const cases: [bigint, number[]][] = [
            [0n, [0, 0, 0, 0, 0, 0, 0, 0]],
            [1n, [1, 0, 0, 0, 0, 0, 0, 0]],
            [0x0123456789abcdefn, [0xef, 0xcd, 0xab, 0x89, 0x67, 0x45, 0x23, 0x01]],
            [0xffffffffffffffffn, [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]],
        ];
        for (const [value, bytes] of cases) {
            it(`encodes and decodes ${value} little-endian`, () => {
                const buffer = new Uint8Array(10);
                expect(u64().encode(value, buffer, 1)).to.equal(8);
                expect(Array.from(buffer.subarray(1, 9))).to.deep.equal(bytes);
                expect(u64().decode(buffer, 1)).to.equal(value);
            });
        }

        it('rejects values outside the u64 range', () => {
            expect(() => u64().encode(-1n, new Uint8Array(8))).to.throw(RangeError);
            expect(() => u64().encode(0x10000000000000000n, new Uint8Array(8))).to.throw(RangeError);
        });

        it('rejects non-bigint values', () => {
            expect(() => u64().encode(1 as unknown as bigint, new Uint8Array(8))).to.throw('Expected a `BigInt`');
        });
    });

    it('encodes and decodes bool', () => {
        const buffer = new Uint8Array(2);
        bool().encode(true, buffer, 1);
        expect(Array.from(buffer)).to.deep.equal([0, 1]);
        expect(bool().decode(buffer, 1)).to.equal(true);
        expect(bool().decode(buffer, 0)).to.equal(false);
    });

    it('encodes and decodes publicKey', () => {
        const key = PublicKey.unique();
        const buffer = new Uint8Array(33);
        expect(publicKey().encode(key, buffer, 1)).to.equal(32);
        expect(Array.from(buffer.subarray(1))).to.deep.equal(Array.from(key.toBytes()));
        expect(publicKey().decode(buffer, 1).equals(key)).to.equal(true);
    });
});
