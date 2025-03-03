/**
 * This code was AUTOGENERATED using the codama library.
 * Please DO NOT EDIT THIS FILE, instead use visitors
 * to add features, then rerun codama to update it.
 *
 * @see https://github.com/codama-idl/codama
 */

import {
  combineCodec,
  getStructDecoder,
  getStructEncoder,
  getU16Decoder,
  getU16Encoder,
  getU64Decoder,
  getU64Encoder,
  type Codec,
  type Decoder,
  type Encoder,
} from '@solana/kit';

export type TransferFee = {
  /** First epoch where the transfer fee takes effect. */
  epoch: bigint;
  /** Maximum fee assessed on transfers, expressed as an amount of tokens. */
  maximumFee: bigint;
  /**
   * Amount of transfer collected as fees, expressed as basis points of the
   * transfer amount, ie. increments of 0.01%.
   */
  transferFeeBasisPoints: number;
};

export type TransferFeeArgs = {
  /** First epoch where the transfer fee takes effect. */
  epoch: number | bigint;
  /** Maximum fee assessed on transfers, expressed as an amount of tokens. */
  maximumFee: number | bigint;
  /**
   * Amount of transfer collected as fees, expressed as basis points of the
   * transfer amount, ie. increments of 0.01%.
   */
  transferFeeBasisPoints: number;
};

export function getTransferFeeEncoder(): Encoder<TransferFeeArgs> {
  return getStructEncoder([
    ['epoch', getU64Encoder()],
    ['maximumFee', getU64Encoder()],
    ['transferFeeBasisPoints', getU16Encoder()],
  ]);
}

export function getTransferFeeDecoder(): Decoder<TransferFee> {
  return getStructDecoder([
    ['epoch', getU64Decoder()],
    ['maximumFee', getU64Decoder()],
    ['transferFeeBasisPoints', getU16Decoder()],
  ]);
}

export function getTransferFeeCodec(): Codec<TransferFeeArgs, TransferFee> {
  return combineCodec(getTransferFeeEncoder(), getTransferFeeDecoder());
}
