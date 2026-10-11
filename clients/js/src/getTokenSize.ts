import { getConstantEncoder, getHiddenPrefixEncoder, getU8Encoder } from '@solana/kit';

import { ExtensionArgs, getMultisigSize } from './generated';
import { getExtensionsEncoder } from './hooked';

const TOKEN_BASE_SIZE = 165;

export function getTokenSize(extensions?: ExtensionArgs[]): number {
    if (extensions == null) return TOKEN_BASE_SIZE;
    const tvlEncoder = getHiddenPrefixEncoder(getExtensionsEncoder(), [getConstantEncoder(getU8Encoder().encode(2))]);
    const size = TOKEN_BASE_SIZE + tvlEncoder.encode(extensions).length;
    // The program adds two bytes of padding so a token account is never the size of a multisig.
    return size === getMultisigSize() ? size + 2 : size;
}
