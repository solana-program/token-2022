import { Address, IInstruction, TransactionSigner } from '@solana/web3.js';
import {
  ExtensionArgs,
  getDisableMemoTransfersInstruction,
  getEnableMemoTransfersInstruction,
  getInitializeConfidentialTransferMintInstruction,
  getInitializeDefaultAccountStateInstruction,
  getInitializeGroupPointerInstruction,
  getInitializeMetadataPointerInstruction,
  getInitializeTransferFeeConfigInstruction,
} from './generated';

/**
 * Given a mint address and a list of mint extensions, returns a list of
 * instructions that MUST be run _before_ the `initializeMint` instruction
 * to properly initialize the given extensions on the mint account.
 */
export function getPreInitializeInstructionsForMintExtensions(
  mint: Address,
  extensions: ExtensionArgs[]
): IInstruction[] {
  return extensions.flatMap((extension) => {
    switch (extension.__kind) {
      case 'ConfidentialTransferMint':
        return [
          getInitializeConfidentialTransferMintInstruction({
            mint,
            ...extension,
          }),
        ];
      case 'DefaultAccountState':
        return [
          getInitializeDefaultAccountStateInstruction({
            mint,
            state: extension.state,
          }),
        ];
      case 'TransferFeeConfig':
        return [
          getInitializeTransferFeeConfigInstruction({
            mint,
            transferFeeConfigAuthority: extension.transferFeeConfigAuthority,
            withdrawWithheldAuthority: extension.withdrawWithheldAuthority,
            transferFeeBasisPoints:
              extension.newerTransferFee.transferFeeBasisPoints,
            maximumFee: extension.newerTransferFee.maximumFee,
          }),
        ];
      case 'MetadataPointer':
        return [
          getInitializeMetadataPointerInstruction({
            mint,
            authority: extension.authority,
            metadataAddress: extension.metadataAddress,
          }),
        ];
      case 'GroupPointer':
        return [
          getInitializeGroupPointerInstruction({
            mint,
            authority: extension.authority,
            groupAddress: extension.groupAddress,
          }),
        ];
      default:
        return [];
    }
  });
}

/**
 * Given a mint address and a list of mint extensions, returns a list of
 * instructions that MUST be run _after_ the `initializeMint` instruction
 * to properly initialize the given extensions on the mint account.
 */
export function getPostInitializeInstructionsForMintExtensions(
  _mint: Address,
  extensions: ExtensionArgs[]
): IInstruction[] {
  return extensions.flatMap((extension) => {
    switch (extension.__kind) {
      default:
        return [];
    }
  });
}

/**
 * Given a token address, its owner and a list of token extensions, returns a list
 * of instructions that MUST be run _after_ the `initializeAccount` instruction
 * to properly initialize the given extensions on the token account.
 */
export function getPostInitializeInstructionsForTokenExtensions(
  token: Address,
  owner: TransactionSigner,
  extensions: ExtensionArgs[]
): IInstruction[] {
  return extensions.flatMap((extension) => {
    switch (extension.__kind) {
      case 'MemoTransfer':
        return [
          extension.requireIncomingTransferMemos
            ? getEnableMemoTransfersInstruction({ owner, token })
            : getDisableMemoTransfersInstruction({ owner, token }),
        ];
      default:
        return [];
    }
  });
}
