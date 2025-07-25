/**
 * This code was AUTOGENERATED using the codama library.
 * Please DO NOT EDIT THIS FILE, instead use visitors
 * to add features, then rerun codama to update it.
 *
 * @see https://github.com/codama-idl/codama
 */

import {
  combineCodec,
  fixDecoderSize,
  fixEncoderSize,
  getBytesDecoder,
  getBytesEncoder,
  type FixedSizeCodec,
  type FixedSizeDecoder,
  type FixedSizeEncoder,
  type ReadonlyUint8Array,
} from '@solana/kit';

/** ElGamal ciphertext containing an account balance. */
export type EncryptedBalance = ReadonlyUint8Array;

export type EncryptedBalanceArgs = EncryptedBalance;

export function getEncryptedBalanceEncoder(): FixedSizeEncoder<EncryptedBalanceArgs> {
  return fixEncoderSize(getBytesEncoder(), 64);
}

export function getEncryptedBalanceDecoder(): FixedSizeDecoder<EncryptedBalance> {
  return fixDecoderSize(getBytesDecoder(), 64);
}

export function getEncryptedBalanceCodec(): FixedSizeCodec<
  EncryptedBalanceArgs,
  EncryptedBalance
> {
  return combineCodec(
    getEncryptedBalanceEncoder(),
    getEncryptedBalanceDecoder()
  );
}
