import { blob } from '@solana/buffer-layout';
import type { Layout } from '@solana/buffer-layout';
import { encodeDecode } from '@solana/buffer-layout-utils';
import { PodElGamalPubkey, PodElGamalCiphertext, PodAeCiphertext } from '@solana/zk-sdk';

export const elgamalPublicKey = (property?: string): Layout<PodElGamalPubkey> => {
    const layout = blob(32, property);
    const { encode, decode } = encodeDecode(layout);

    const elgamalPublicKeyLayout = layout as Layout<unknown> as Layout<PodElGamalPubkey>;

    elgamalPublicKeyLayout.decode = (buffer: Buffer, offset: number) => {
        const src = decode(buffer, offset);
        return new PodElGamalPubkey(src);
    };

    elgamalPublicKeyLayout.encode = (elgamalPublicKey: PodElGamalPubkey, buffer: Buffer, offset: number) => {
        const src = elgamalPublicKey.toBytes();
        return encode(src, buffer, offset);
    };

    return elgamalPublicKeyLayout;
};

export const elgamalCiphertext = (property?: string): Layout<PodElGamalCiphertext> => {
    const layout = blob(64, property);
    const { encode, decode } = encodeDecode(layout);

    const elgamalCiphertextLayout = layout as Layout<unknown> as Layout<PodElGamalCiphertext>;

    elgamalCiphertextLayout.decode = (buffer: Buffer, offset: number) => {
        const src = decode(buffer, offset);
        return new PodElGamalCiphertext(src);
    };

    elgamalCiphertextLayout.encode = (elgamalCiphertext: PodElGamalCiphertext, buffer: Buffer, offset: number) => {
        const src = elgamalCiphertext.toBytes();
        return encode(src, buffer, offset);
    };

    return elgamalCiphertextLayout;
};

export const aeCiphertext = (property?: string): Layout<PodAeCiphertext> => {
    const layout = blob(36, property);
    const { encode, decode } = encodeDecode(layout);

    const aeCiphertextLayout = layout as Layout<unknown> as Layout<PodAeCiphertext>;

    aeCiphertextLayout.decode = (buffer: Buffer, offset: number) => {
        const src = decode(buffer, offset);
        return new PodAeCiphertext(src);
    };

    aeCiphertextLayout.encode = (aeCiphertext: PodAeCiphertext, buffer: Buffer, offset: number) => {
        const src = aeCiphertext.toBytes();
        return encode(src, buffer, offset);
    };

    return aeCiphertextLayout;
};
