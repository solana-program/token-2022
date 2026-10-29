import { PUBLIC_KEY_LENGTH, PublicKey } from '@solana/web3.js';
import type { AccountMeta, Connection } from '@solana/web3.js';
import {
    TokenTransferHookAccountDataNotFound,
    TokenTransferHookInvalidPubkeyData,
    TokenTransferHookPubkeyDataTooSmall,
    TokenTransferHookAccountNotFound,
} from '../../errors.js';
import { fetchAccountData, type PreloadedAccounts } from './preloadedAccounts.js';

export async function unpackPubkeyData(
    keyDataConfig: Uint8Array,
    previousMetas: AccountMeta[],
    instructionData: Buffer,
    connection: Connection,
    preloadedAccounts?: PreloadedAccounts,
): Promise<PublicKey> {
    const [discriminator, ...rest] = keyDataConfig;
    const remaining = new Uint8Array(rest);
    switch (discriminator) {
        case 1:
            return unpackPubkeyDataFromInstructionData(remaining, instructionData);
        case 2:
            return unpackPubkeyDataFromAccountData(remaining, previousMetas, connection, preloadedAccounts);
        default:
            throw new TokenTransferHookInvalidPubkeyData();
    }
}

function unpackPubkeyDataFromInstructionData(remaining: Uint8Array, instructionData: Buffer): PublicKey {
    if (remaining.length < 1) {
        throw new TokenTransferHookInvalidPubkeyData();
    }
    const dataIndex = remaining[0];
    if (instructionData.length < dataIndex + PUBLIC_KEY_LENGTH) {
        throw new TokenTransferHookPubkeyDataTooSmall();
    }
    return new PublicKey(instructionData.subarray(dataIndex, dataIndex + PUBLIC_KEY_LENGTH));
}

async function unpackPubkeyDataFromAccountData(
    remaining: Uint8Array,
    previousMetas: AccountMeta[],
    connection: Connection,
    preloadedAccounts?: PreloadedAccounts,
): Promise<PublicKey> {
    if (remaining.length < 2) {
        throw new TokenTransferHookInvalidPubkeyData();
    }
    const [accountIndex, dataIndex] = remaining;
    if (previousMetas.length <= accountIndex) {
        throw new TokenTransferHookAccountDataNotFound();
    }
    const accountData = await fetchAccountData(connection, previousMetas[accountIndex].pubkey, preloadedAccounts);
    if (accountData == null) {
        throw new TokenTransferHookAccountNotFound();
    }
    if (accountData.length < dataIndex + PUBLIC_KEY_LENGTH) {
        throw new TokenTransferHookPubkeyDataTooSmall();
    }
    return new PublicKey(accountData.subarray(dataIndex, dataIndex + PUBLIC_KEY_LENGTH));
}
