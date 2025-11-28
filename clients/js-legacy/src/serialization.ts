import { Layout } from '@solana/buffer-layout';
import { publicKey, u64 } from '@solana/buffer-layout-utils';
import type { PublicKey } from '@solana/web3.js';

export class COptionPublicKeyLayout extends Layout<PublicKey | null> {
    private publicKeyLayout: Layout<PublicKey>;

    constructor(property?: string | undefined) {
        super(-1, property);
        this.publicKeyLayout = publicKey();
    }

    decode(buffer: Uint8Array, offset: number = 0): PublicKey | null {
        const option = buffer[offset];
        if (option === 0) {
            return null;
        }
        return this.publicKeyLayout.decode(buffer, offset + 1);
    }

    encode(src: PublicKey | null, buffer: Uint8Array, offset: number = 0): number {
        if (src === null) {
            buffer[offset] = 0;
            return 1;
        } else {
            buffer[offset] = 1;
            this.publicKeyLayout.encode(src, buffer, offset + 1);
            return 33;
        }
    }

    getSpan(buffer?: Uint8Array, offset: number = 0): number {
        if (buffer) {
            const option = buffer[offset];
            return option === 0 ? 1 : 1 + this.publicKeyLayout.span;
        }
        throw new RangeError('Buffer must be provided');
    }
}

export class COptionU64Layout extends Layout<bigint | null> {
    private u64Layout: Layout<bigint>;

    constructor(property?: string | undefined) {
        super(-1, property);
        this.u64Layout = u64();
    }

    decode(buffer: Uint8Array, offset: number = 0): bigint | null {
        const option = buffer[offset];
        if (option === 0) {
            return null;
        }
        return this.u64Layout.decode(buffer, offset + 1);
    }

    encode(src: bigint | null, buffer: Uint8Array, offset: number = 0): number {
        if (src === null) {
            buffer[offset] = 0;
            return 1;
        } else {
            buffer[offset] = 1;
            this.u64Layout.encode(src, buffer, offset + 1);
            return 9;
        }
    }

    getSpan(buffer?: Uint8Array, offset: number = 0): number {
        if (buffer) {
            const option = buffer[offset];
            return option === 0 ? 1 : 1 + this.u64Layout.span;
        }
        throw new RangeError('Buffer must be provided');
    }
}
