import {
  getArrayEncoder,
  getConstantEncoder,
  getHiddenPrefixEncoder,
  getU8Encoder,
  padLeftEncoder,
} from '@solana/kit';
import { ExtensionArgs, getExtensionEncoder } from './generated';

const MINT_BASE_SIZE = 82;

export function getMintSize(extensions?: ExtensionArgs[]): number {
  if (extensions == null) return MINT_BASE_SIZE;
  const tvlEncoder = getHiddenPrefixEncoder(
    getArrayEncoder(getExtensionEncoder(), { size: 'remainder' }),
    [getConstantEncoder(padLeftEncoder(getU8Encoder(), 83).encode(1))]
  );
  return MINT_BASE_SIZE + tvlEncoder.encode(extensions).length;
}
