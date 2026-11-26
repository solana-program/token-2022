import { ns64, s16, struct } from '@solana/buffer-layout';
import { publicKey } from '@solana/buffer-layout-utils';
import { PublicKey } from '@solana/web3.js';
import type { Mint } from '../../state/mint.js';
import { ExtensionType, getExtensionData } from '../extensionType.js';

export interface InterestBearingMintConfigState {
    rateAuthority: PublicKey | null;
    initializationTimestamp: bigint;
    preUpdateAverageRate: number;
    lastUpdateTimestamp: bigint;
    currentRate: number;
}

export const InterestBearingMintConfigStateLayout = struct<
    InterestBearingMintConfigState & { rateAuthority: PublicKey }
>([
    publicKey('rateAuthority'),
    ns64('initializationTimestamp'),
    s16('preUpdateAverageRate'),
    ns64('lastUpdateTimestamp'),
    s16('currentRate'),
]);

export const INTEREST_BEARING_MINT_CONFIG_STATE_SIZE = InterestBearingMintConfigStateLayout.span;

export function getInterestBearingMintConfigState(mint: Mint): InterestBearingMintConfigState | null {
    const extensionData = getExtensionData(ExtensionType.InterestBearingConfig, mint.tlvData);
    if (extensionData !== null) {
        const { rateAuthority, ...config } = InterestBearingMintConfigStateLayout.decode(extensionData);
        return {
            ...config,
            rateAuthority: rateAuthority.equals(PublicKey.default) ? null : rateAuthority,
        };
    }
    return null;
}
