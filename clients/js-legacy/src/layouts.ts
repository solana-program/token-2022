import type { Layout } from '@solana/buffer-layout';
import { blob, u8 } from '@solana/buffer-layout';
import { PublicKey } from '@solana/web3.js';

// Same layouts as `@solana/buffer-layout-utils`, without its native `bigint-buffer` dependency.

const U64_MAX = BigInt('0xffffffffffffffff');

export const bool = (property?: string): Layout<boolean> => {
    const layout = u8(property);
    const decode = layout.decode.bind(layout);
    const encode = layout.encode.bind(layout);

    const boolLayout = layout as Layout<unknown> as Layout<boolean>;
    boolLayout.decode = (buffer: Uint8Array, offset = 0) => !!decode(buffer, offset);
    boolLayout.encode = (value: boolean, buffer: Uint8Array, offset = 0) => encode(Number(value), buffer, offset);
    return boolLayout;
};

export const publicKey = (property?: string): Layout<PublicKey> => {
    const layout = blob(32, property);
    const decode = layout.decode.bind(layout);
    const encode = layout.encode.bind(layout);

    const publicKeyLayout = layout as Layout<unknown> as Layout<PublicKey>;
    publicKeyLayout.decode = (buffer: Uint8Array, offset = 0) => new PublicKey(decode(buffer, offset));
    publicKeyLayout.encode = (value: PublicKey, buffer: Uint8Array, offset = 0) =>
        encode(value.toBytes(), buffer, offset);
    return publicKeyLayout;
};

export const u64 = (property?: string): Layout<bigint> => {
    const layout = blob(8, property);
    const decode = layout.decode.bind(layout);
    const encode = layout.encode.bind(layout);

    const u64Layout = layout as Layout<unknown> as Layout<bigint>;
    u64Layout.decode = (buffer: Uint8Array, offset = 0) => {
        const src = decode(buffer, offset);
        return new DataView(src.buffer, src.byteOffset, src.byteLength).getBigUint64(0, true);
    };
    u64Layout.encode = (value: bigint, buffer: Uint8Array, offset = 0) => {
        if (typeof value !== 'bigint') {
            throw new Error('Expected a `BigInt`');
        }
        if (value < BigInt(0) || value > U64_MAX) {
            throw new RangeError(`u64 out of range: ${value}`);
        }
        const src = new Uint8Array(8);
        new DataView(src.buffer).setBigUint64(0, value, true);
        return encode(src, buffer, offset);
    };
    return u64Layout;
};
