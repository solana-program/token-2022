import {
  getArrayEncoder,
  getConstantEncoder,
  getHiddenPrefixEncoder,
  getU8Encoder,
} from '@solana/kit';
import { ExtensionArgs, getExtensionEncoder } from './generated';

const TOKEN_BASE_SIZE = 165;

export function getTokenSize(extensions?: ExtensionArgs[]): number {
  if (extensions == null) return TOKEN_BASE_SIZE;
  const tvlEncoder = getHiddenPrefixEncoder(
    getArrayEncoder(getExtensionEncoder(), { size: 'remainder' }),
    [getConstantEncoder(getU8Encoder().encode(2))]
  );
  return TOKEN_BASE_SIZE + tvlEncoder.encode(extensions).length;
}
