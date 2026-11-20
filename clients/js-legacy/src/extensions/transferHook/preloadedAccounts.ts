import type { Connection, PublicKey } from '@solana/web3.js';

/**
 * Account data supplied by the caller, keyed by base-58 address.
 *
 * Extra-account-meta resolution reads on-chain account data to derive seeds
 * (`Seed::AccountData`) and pubkeys (`PubkeyData::AccountData`). That assumes
 * every referenced account already exists, which is not true when the same
 * transaction creates one of them first — most commonly the recipient's
 * associated token account, which is created immediately before the transfer.
 *
 * Supplying the data here lets resolution succeed for accounts that will exist
 * by the time the instruction executes. Entries take precedence over
 * `Connection.getAccountInfo`, so callers must only provide data that matches
 * what the account will actually contain; on-chain resolution re-derives every
 * address and rejects a mismatch.
 */
export type PreloadedAccounts = Map<string, Buffer>;

/**
 * Read an account's data, preferring caller-supplied data when present.
 *
 * @param connection        Connection to use
 * @param pubkey            Account to read
 * @param preloadedAccounts Optional caller-supplied account data
 *
 * @return The account data, or `null` when the account neither exists nor was supplied
 */
export async function fetchAccountData(
    connection: Connection,
    pubkey: PublicKey,
    preloadedAccounts?: PreloadedAccounts,
): Promise<Buffer | null> {
    const preloaded = preloadedAccounts?.get(pubkey.toBase58());
    if (preloaded !== undefined) {
        return preloaded;
    }
    const accountInfo = await connection.getAccountInfo(pubkey);
    return accountInfo === null ? null : accountInfo.data;
}
