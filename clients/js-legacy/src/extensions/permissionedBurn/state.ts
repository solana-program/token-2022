import { struct } from '@solana/buffer-layout';
import { publicKey } from '@solana/buffer-layout-utils';
import { PublicKey } from '@solana/web3.js';
import type { Mint } from '../../state/mint.js';
import { ExtensionType, getExtensionData } from '../extensionType.js';

/** Permissioned burn configuration as stored by the program */
export interface PermissionedBurn {
    authority: PublicKey | null;
}

/** Buffer layout for de/serializing a permissioned burn config */
export const PermissionedBurnLayout = struct<{ authority: PublicKey }>([publicKey('authority')]);

export const PERMISSIONED_BURN_SIZE = PermissionedBurnLayout.span;

export function getPermissionedBurn(mint: Mint): PermissionedBurn | null {
    const extensionData = getExtensionData(ExtensionType.PermissionedBurn, mint.tlvData);
    if (extensionData !== null) {
        const { authority } = PermissionedBurnLayout.decode(extensionData);
        return {
            authority: authority.equals(PublicKey.default) ? null : authority,
        };
    } else {
        return null;
    }
}
