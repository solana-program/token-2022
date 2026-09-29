import { struct } from '@solana/buffer-layout';
import { publicKey, bool } from '@solana/buffer-layout-utils';
import { PublicKey } from '@solana/web3.js';
import type { Account } from '../../state/account.js';
import type { Mint } from '../../state/mint.js';
import { ExtensionType, getExtensionData } from '../extensionType.js';

/** PausableConfig as stored by the program */
export interface PausableConfig {
    /** Optional authority that can pause or resume activity on the mint */
    authority: PublicKey | null;
    /** Whether minting / transferring / burning tokens is paused */
    paused: boolean;
}

/** Buffer layout for de/serializing a pausable config */
export const PausableConfigLayout = struct<{ authority: PublicKey; paused: boolean }>([
    publicKey('authority'),
    bool('paused'),
]);

export const PAUSABLE_CONFIG_SIZE = PausableConfigLayout.span;

export function getPausableConfig(mint: Mint): PausableConfig | null {
    const extensionData = getExtensionData(ExtensionType.PausableConfig, mint.tlvData);
    if (extensionData !== null) {
        const { authority, paused } = PausableConfigLayout.decode(extensionData);
        return {
            authority: authority.equals(PublicKey.default) ? null : authority,
            paused,
        };
    } else {
        return null;
    }
}

/** Pausable token account state as stored by the program */
export interface PausableAccount {} // eslint-disable-line

/** Buffer layout for de/serializing a pausable account */
export const PausableAccountLayout = struct<PausableAccount>([]); // esline-disable-line

export const PAUSABLE_ACCOUNT_SIZE = PausableAccountLayout.span;

export function getPausableAccount(account: Account): PausableAccount | null {
    const extensionData = getExtensionData(ExtensionType.PausableAccount, account.tlvData);
    if (extensionData !== null) {
        return PausableAccountLayout.decode(extensionData);
    } else {
        return null;
    }
}
