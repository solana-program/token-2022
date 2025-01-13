import { struct } from '@solana/buffer-layout';
import { publicKey, bool, u64 } from '@solana/buffer-layout-utils';
import type { PublicKey } from '@solana/web3.js';
import type { Mint } from '../../state/mint.js';
import type { Account } from '../../state/account.js';
import { ExtensionType, getExtensionData } from '../extensionType.js';
import type { PodElGamalPubkey, PodElGamalCiphertext, PodAeCiphertext } from '@solana/zk-sdk';
import { elgamalPublicKey, elgamalCiphertext, aeCiphertext } from './elgamal.js';

/** ConfidentialTransferMint as stored by the program */
export interface ConfidentialTransferMint {
    confidentialTransferMintAuthority: PublicKey;
    autoApproveNewAccounts: boolean;
    auditorElGamalPubkey: PodElGamalPubkey;
}

/** Buffer layout for de/serializing a confidential transfer mint */
export const ConfidentialTransferMintLayout = struct<ConfidentialTransferMint>([
    publicKey('confidentialTransferMintAuthority'),
    bool('autoApproveNewAccounts'),
    elgamalPublicKey('auditorElGamalPubkey'),
]);

export const CONFIDENTIAL_TRANSFER_MINT_SIZE = ConfidentialTransferMintLayout.span;

export function getConfidentialTransferMint(mint: Mint): ConfidentialTransferMint | null {
    const extensionData = getExtensionData(ExtensionType.ConfidentialTransferMint, mint.tlvData);
    if (extensionData !== null) {
        return ConfidentialTransferMintLayout.decode(extensionData);
    } else {
        return null;
    }
}

/** ConfidentialTransferAccount as stored by the program */
export interface ConfidentialTransferAccount {
    approved: boolean;
    elgamalPubkey: PodElGamalPubkey;
    pendingBalanceLo: PodElGamalCiphertext;
    pendingBalanceHi: PodElGamalCiphertext;
    availableBalance: PodElGamalCiphertext;
    decryptableAvailableBalance: PodAeCiphertext;
    allowConfidentialCredits: boolean;
    allowNonConfidentialCredits: boolean;
    pendingBalanceCreditCounter: bigint;
    maximumPendingBalanceCreditCounter: bigint;
    expectedPendingBalanceCreditCounter: bigint;
    actualPendingBalanceCreditCounter: bigint;
}

/** Buffer layout for de/serializing a confidential transfer account */
export const ConfidentialTransferAccountLayout = struct<ConfidentialTransferAccount>([
    bool('approved'),
    elgamalPublicKey('elgamalPubkey'),
    elgamalCiphertext('pendingBalanceLo'),
    elgamalCiphertext('pendingBalanceLo'),
    elgamalCiphertext('availableBalance'),
    aeCiphertext('decryptableAvailableBalance'),
    bool('allowConfidentialCredits'),
    bool('allowNonConfidentialCredits'),
    u64('pendingBalanceCreditCounter'),
    u64('maximumPendingBalanceCreditCounter'),
    u64('expectedPendingBalanceCreditCounter'),
    u64('actualPendingBalanceCreditCounter'),
]);

export const CONFIDENTIAL_TRANSFER_ACCOUNT_SIZE = ConfidentialTransferAccountLayout.span;

export function getConfidentialTransferAccount(account: Account): ConfidentialTransferAccount | null {
    const extensionData = getExtensionData(ExtensionType.ConfidentialTransferAccount, account.tlvData);
    if (extensionData !== null) {
        return ConfidentialTransferAccountLayout.decode(extensionData);
    } else {
        return null;
    }
}
