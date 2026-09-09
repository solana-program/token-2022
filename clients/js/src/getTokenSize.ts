import { getConstantEncoder, getHiddenPrefixEncoder, getU8Encoder } from '@solana/kit';

import { ExtensionArgs } from './generated';
import { getExtensionsEncoder } from './hooked';

const TOKEN_BASE_SIZE = 165;

export function getTokenSize(extensions?: ExtensionArgs[]): number {
    if (extensions == null) return TOKEN_BASE_SIZE;
    const tvlEncoder = getHiddenPrefixEncoder(getExtensionsEncoder(), [getConstantEncoder(getU8Encoder().encode(2))]);
    return TOKEN_BASE_SIZE + tvlEncoder.encode(extensions).length;
}
