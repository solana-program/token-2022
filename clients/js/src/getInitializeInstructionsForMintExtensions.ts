import { Address, IInstruction } from '@solana/web3.js';
import {
  ExtensionArgs,
  getInitializeConfidentialTransferMintInstruction,
  getInitializeDefaultAccountStateInstruction,
  getInitializeTransferFeeConfigInstruction,
} from './generated';

export function getInitializeInstructionsForMintExtensions(
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
      default:
        return [];
    }
  });
}
