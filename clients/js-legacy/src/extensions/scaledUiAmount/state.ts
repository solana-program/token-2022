import { f64, struct } from '@solana/buffer-layout';
import { publicKey, u64 } from '@solana/buffer-layout-utils';
import { PublicKey } from '@solana/web3.js';
import type { Mint } from '../../state/mint.js';
import { ExtensionType, getExtensionData } from '../extensionType.js';

export interface ScaledUiAmountConfig {
    authority: PublicKey | null;
    multiplier: number;
    newMultiplierEffectiveTimestamp: bigint;
    newMultiplier: number;
}

export const ScaledUiAmountConfigLayout = struct<{
    authority: PublicKey;
    multiplier: number;
    newMultiplierEffectiveTimestamp: bigint;
    newMultiplier: number;
}>([publicKey('authority'), f64('multiplier'), u64('newMultiplierEffectiveTimestamp'), f64('newMultiplier')]);

export const SCALED_UI_AMOUNT_CONFIG_SIZE = ScaledUiAmountConfigLayout.span;

export function getScaledUiAmountConfig(mint: Mint): ScaledUiAmountConfig | null {
    const extensionData = getExtensionData(ExtensionType.ScaledUiAmountConfig, mint.tlvData);
    if (extensionData !== null) {
        const { authority, ...config } = ScaledUiAmountConfigLayout.decode(extensionData);
        return {
            authority: authority.equals(PublicKey.default) ? null : authority,
            ...config,
        };
    }
    return null;
}
