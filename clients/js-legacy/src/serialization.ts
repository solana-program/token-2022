import { Layout } from '@solana/buffer-layout';
import type { FixedSizeCodec } from '@solana/codecs-core';
import { fixCodecSize, transformCodec } from '@solana/codecs-core';
import { getBytesCodec, getBooleanCodec } from '@solana/codecs-data-structures';
import { getU64Codec } from '@solana/codecs-numbers';
import { PublicKey } from '@solana/web3.js';

class FixedSizeCodecLayout<TDecoded, TEncoded extends TDecoded = TDecoded> extends Layout<TEncoded> {
    private readonly codec: FixedSizeCodec<TDecoded, TEncoded>;

    constructor(codec: FixedSizeCodec<TDecoded, TEncoded>, property?: string) {
        super(codec.fixedSize, property);
        this.codec = codec;
    }

    decode(buffer: Uint8Array, offset = 0): TEncoded {
        return this.codec.decode(buffer, offset);
    }

    encode(src: TDecoded, buffer: Uint8Array, offset = 0): number {
        this.codec.write(src, buffer, offset);
        return this.codec.fixedSize;
    }
}

class OptionCodecLayout<TDecoded, TEncoded extends TDecoded = TDecoded> extends Layout<TEncoded | null> {
    private readonly codec: FixedSizeCodec<TDecoded, TEncoded>;

    constructor(codec: FixedSizeCodec<TDecoded, TEncoded>, property?: string) {
        super(-1, property);
        this.codec = codec;
    }

    decode(buffer: Uint8Array, offset: number = 0): TEncoded | null {
        if (buffer[offset] === 0) {
            return null;
        }

        return this.codec.decode(buffer, offset + 1);
    }

    encode(src: TDecoded | null, buffer: Uint8Array, offset: number = 0): number {
        if (src === null) {
            buffer[offset] = 0;
            return 1;
        }

        buffer[offset] = 1;
        this.codec.write(src, buffer, offset + 1);

        return 1 + this.codec.fixedSize;
    }

    getSpan(buffer?: Uint8Array, offset: number = 0): number {
        if (!buffer) {
            throw new RangeError('Buffer must be provided');
        }

        return buffer[offset] === 0 ? 1 : 1 + this.codec.fixedSize;
    }
}

const publicKeyCodec = transformCodec(
    fixCodecSize(getBytesCodec(), 32),
    (value: PublicKey) => value.toBytes(),
    bytes => new PublicKey(bytes),
);

const boolCodec = getBooleanCodec();
const u64Codec = getU64Codec();

export function bool(property?: string): Layout<boolean> {
    return new FixedSizeCodecLayout(boolCodec, property);
}

export function publicKey(property?: string): Layout<PublicKey> {
    return new FixedSizeCodecLayout(publicKeyCodec, property);
}

export function u64(property?: string): Layout<bigint> {
    return new FixedSizeCodecLayout(u64Codec, property);
}

export class COptionPublicKeyLayout extends OptionCodecLayout<PublicKey> {
    constructor(property?: string | undefined) {
        super(publicKeyCodec, property);
    }
}

export class COptionU64Layout extends OptionCodecLayout<bigint> {
    constructor(property?: string | undefined) {
        super(u64Codec, property);
    }
}
