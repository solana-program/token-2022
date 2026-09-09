import {
    combineCodec,
    createDecoder,
    getArrayEncoder,
    getU16Decoder,
    type Codec,
    type Decoder,
    type Encoder,
} from '@solana/kit';

import { getExtensionDecoder, getExtensionEncoder, type Extension, type ExtensionArgs } from '../generated/types';

/**
 * The list of extensions stored in the TLV region of a `Mint` or `Token` account.
 */
export type Extensions = Array<Extension>;

/**
 * The list of extensions accepted when encoding the TLV region of a `Mint` or `Token` account.
 */
export type ExtensionsArgs = Array<ExtensionArgs>;

// Number of bytes used by the `type` header of a TLV entry (`ExtensionType` is a `u16`).
const EXTENSION_TYPE_SIZE = 2;

// Discriminator of the `Uninitialized` extension type, used as padding at the end of the TLV region.
const UNINITIALIZED_EXTENSION_TYPE = 0;

/**
 * Encodes the extensions of a `Mint` or `Token` account as consecutive TLV entries.
 *
 * The encoder adds no padding of its own; the program appends `Uninitialized` padding
 * when needed (e.g. to avoid colliding with the `Multisig` account length). An explicit
 * `{ __kind: 'Uninitialized' }` entry still encodes as a two-byte header.
 */
export function getExtensionsEncoder(): Encoder<ExtensionsArgs> {
    return getArrayEncoder(getExtensionEncoder(), { size: 'remainder' });
}

/**
 * Decodes the extensions of a `Mint` or `Token` account from its TLV region.
 *
 * Mirrors the program's `try_for_each_tlv_extension_type`: entries are read one after the
 * other until an `Uninitialized` (type `0`) header is found or fewer than two bytes remain.
 * Anything after that point is unused space and is ignored, so accounts allocated with
 * spare room (of any size, including odd or two-byte multisig padding) decode correctly.
 *
 * `Uninitialized` padding entries are never included in the decoded list.
 *
 * The TLV region is expected to extend to the end of the buffer: the decoder consumes any
 * trailing bytes, so it must be the last field of the enclosing struct.
 */
export function getExtensionsDecoder(): Decoder<Extensions> {
    const extensionDecoder = getExtensionDecoder();
    const extensionTypeDecoder = getU16Decoder();
    return createDecoder({
        read: (bytes, offset) => {
            const extensions: Extensions = [];
            while (offset + EXTENSION_TYPE_SIZE <= bytes.length) {
                const [extensionType] = extensionTypeDecoder.read(bytes, offset);
                if (extensionType === UNINITIALIZED_EXTENSION_TYPE) break;
                const [extension, nextOffset] = extensionDecoder.read(bytes, offset);
                extensions.push(extension);
                offset = nextOffset;
            }
            // Consume the remaining (unused) bytes so the enclosing codecs see the whole region as read.
            return [extensions, bytes.length];
        },
    });
}

/**
 * Codec for the extensions of a `Mint` or `Token` account.
 */
export function getExtensionsCodec(): Codec<ExtensionsArgs, Extensions> {
    return combineCodec(getExtensionsEncoder(), getExtensionsDecoder());
}
