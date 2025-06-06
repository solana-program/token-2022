import {
  Address,
  IInstruction,
  isNone,
  isOption,
  TransactionSigner,
  wrapNullable,
} from '@solana/kit';
import {
  ExtensionArgs,
  getDisableMemoTransfersInstruction,
  getEnableMemoTransfersInstruction,
  getEnableCpiGuardInstruction,
  getDisableCpiGuardInstruction,
  getInitializeConfidentialTransferMintInstruction,
  getInitializeDefaultAccountStateInstruction,
  getInitializeGroupMemberPointerInstruction,
  getInitializeGroupPointerInstruction,
  getInitializeInterestBearingMintInstruction,
  getInitializeMetadataPointerInstruction,
  getInitializeMintCloseAuthorityInstruction,
  getInitializeTokenGroupInstruction,
  getInitializeTokenMetadataInstruction,
  getInitializeTransferFeeConfigInstruction,
  getInitializeNonTransferableMintInstruction,
  getInitializeTransferHookInstruction,
  getInitializePermanentDelegateInstruction,
  getInitializeScaledUiAmountMintInstruction,
  getInitializeConfidentialTransferFeeInstruction,
  getInitializePausableConfigInstruction,
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
      case 'InterestBearingConfig':
        return [
          getInitializeInterestBearingMintInstruction({
            mint,
            rateAuthority: extension.rateAuthority,
            rate: extension.currentRate,
          }),
        ];
      case 'ScaledUiAmountConfig':
        return [
          getInitializeScaledUiAmountMintInstruction({
            mint,
            authority: extension.authority,
            multiplier: extension.multiplier,
          }),
        ];
      case 'PausableConfig':
        return [
          getInitializePausableConfigInstruction({
            mint,
            authority: extension.authority,
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
      case 'GroupMemberPointer':
        return [
          getInitializeGroupMemberPointerInstruction({
            mint,
            authority: extension.authority,
            memberAddress: extension.memberAddress,
          }),
        ];
      case 'NonTransferable':
        return getInitializeNonTransferableMintInstruction({ mint });
      case 'TransferHook':
        return [
          getInitializeTransferHookInstruction({
            mint,
            authority: extension.authority,
            programId: extension.programId,
          }),
        ];
      case 'PermanentDelegate':
        return getInitializePermanentDelegateInstruction({
          mint,
          delegate: extension.delegate,
        });
      case 'ConfidentialTransferFee':
        return [
          getInitializeConfidentialTransferFeeInstruction({
            mint,
            authority: extension.authority,
            withdrawWithheldAuthorityElGamalPubkey: extension.elgamalPubkey,
          }),
        ];
      case 'MintCloseAuthority':
        return getInitializeMintCloseAuthorityInstruction({
          closeAuthority: extension.closeAuthority,
          mint,
        });
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
  mint: Address,
  authority: TransactionSigner,
  extensions: ExtensionArgs[]
): IInstruction[] {
  return extensions.flatMap((extension): IInstruction[] => {
    switch (extension.__kind) {
      case 'TokenMetadata':
        // eslint-disable-next-line no-case-declarations
        const tokenMetadataUpdateAuthority = isOption(extension.updateAuthority)
          ? extension.updateAuthority
          : wrapNullable(extension.updateAuthority);
        if (isNone(tokenMetadataUpdateAuthority)) {
          return [];
        }
        return [
          getInitializeTokenMetadataInstruction({
            metadata: mint,
            updateAuthority: tokenMetadataUpdateAuthority.value,
            mint,
            mintAuthority: authority,
            name: extension.name,
            symbol: extension.symbol,
            uri: extension.uri,
          }),
        ];
      case 'TokenGroup':
        return [
          getInitializeTokenGroupInstruction({
            group: mint,
            updateAuthority: isOption(extension.updateAuthority)
              ? extension.updateAuthority
              : wrapNullable(extension.updateAuthority),
            mint,
            mintAuthority: authority,
            maxSize: extension.maxSize,
          }),
        ];
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
  owner: TransactionSigner | Address,
  extensions: ExtensionArgs[],
  multiSigners?: TransactionSigner[]
): IInstruction[] {
  return extensions.flatMap((extension) => {
    switch (extension.__kind) {
      case 'MemoTransfer':
        return [
          extension.requireIncomingTransferMemos
            ? getEnableMemoTransfersInstruction({ owner, token, multiSigners })
            : getDisableMemoTransfersInstruction({
                owner,
                token,
                multiSigners,
              }),
        ];
      case 'CpiGuard':
        return [
          extension.lockCpi
            ? getEnableCpiGuardInstruction({ owner, token, multiSigners })
            : getDisableCpiGuardInstruction({
                owner,
                token,
                multiSigners,
              }),
        ];
      default:
        return [];
    }
  });
}
