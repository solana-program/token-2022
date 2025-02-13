import { PublicKey } from '@solana/web3.js';
import type { AccountMeta, Connection } from '@solana/web3.js';
import { TokenTransferHookAccountDataNotFound, TokenTransferHookInvalidPubkeyData, TokenTransferHookPubkeyDataTooSmall, TokenTransferHookAccountNotFound} from '../../errors.js';

export async function unpackPubkeyData(
    keyDataConfig: Uint8Array,
    previousMetas: AccountMeta[],
    instructionData: Buffer,
    connection: Connection,
): Promise<PublicKey> {
    const [discriminator, ...rest] = keyDataConfig;
    const remaining = new Uint8Array(rest);
    switch (discriminator) {
        case 1:
            return unpackPubkeyDataFromInstructionData(remaining, instructionData);
        case 2:
            return await unpackPubkeyDataFromAccountData(remaining, previousMetas, connection);
        default:
            throw new TokenTransferHookInvalidPubkeyData();
    }
}

function unpackPubkeyDataFromInstructionData(remaining: Uint8Array, instructionData: Buffer): PublicKey {
    if (remaining.length < 1) {
        throw new TokenTransferHookInvalidPubkeyData();
    }
    if (instructionData.length < 32) {
        throw new TokenTransferHookPubkeyDataTooSmall();
    }
    return new PublicKey(instructionData.subarray(remaining[0], remaining[0] + 32));
}

async function unpackPubkeyDataFromAccountData(remaining: Uint8Array, previousMetas: AccountMeta[], connection: Connection): Promise<PublicKey> {
    if (remaining.length < 2) {
        throw new TokenTransferHookInvalidPubkeyData();
    }
    const [accountIndex, dataIndex] = remaining;
    if (previousMetas.length <= accountIndex) {
        throw new TokenTransferHookAccountDataNotFound();
    }
    const accountInfo = await connection.getAccountInfo(previousMetas[accountIndex].pubkey);
    if (accountInfo == null) {
        throw new TokenTransferHookAccountNotFound();
    }
    if (accountInfo.data.length < dataIndex + 32) {
        throw new TokenTransferHookPubkeyDataTooSmall();
    }
    return new PublicKey(accountInfo.data.subarray(dataIndex, dataIndex + 32));
}