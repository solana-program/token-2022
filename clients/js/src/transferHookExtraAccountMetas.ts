import {
    fixCodecSize,
    getAddressEncoder,
    getArrayCodec,
    getBooleanCodec,
    getBytesCodec,
    getProgramDerivedAddress,
    getStructCodec,
    getU32Codec,
    getU64Codec,
    getU8Codec,
    type Address,
    type Codec,
    type ProgramDerivedAddress,
    type ReadonlyUint8Array,
} from '@solana/kit';

const EXTRA_ACCOUNT_METAS_SEED = 'extra-account-metas';

export type ExtraAccountMetaListSeeds = {
    /** The mint the transfer hook is configured for. */
    mint: Address;
};

/**
 * Finds the PDA storing the list of extra accounts required by a mint's transfer hook program.
 *
 * @param seeds                 The mint the transfer hook is configured for.
 * @param config                The transfer hook program ID that owns the PDA.
 */
export async function findExtraAccountMetaListPda(
    seeds: ExtraAccountMetaListSeeds,
    config: { programAddress: Address },
): Promise<ProgramDerivedAddress> {
    return await getProgramDerivedAddress({
        programAddress: config.programAddress,
        seeds: [EXTRA_ACCOUNT_METAS_SEED, getAddressEncoder().encode(seeds.mint)],
    });
}

/** An `ExtraAccountMeta` as stored by a transfer hook program's validation account. */
export type ExtraAccountMeta = {
    discriminator: number;
    addressConfig: ReadonlyUint8Array;
    isSigner: boolean;
    isWritable: boolean;
};

export function getExtraAccountMetaCodec(): Codec<ExtraAccountMeta> {
    return getStructCodec([
        ['discriminator', getU8Codec()],
        ['addressConfig', fixCodecSize(getBytesCodec(), 32)],
        ['isSigner', getBooleanCodec()],
        ['isWritable', getBooleanCodec()],
    ]);
}

export type ExtraAccountMetaList = {
    count: number;
    extraAccounts: ExtraAccountMeta[];
};

function getExtraAccountMetaListCodec(): Codec<ExtraAccountMetaList> {
    return getStructCodec([
        ['count', getU32Codec()],
        ['extraAccounts', getArrayCodec(getExtraAccountMetaCodec(), { size: 'remainder' })],
    ]);
}

// `ExtraAccountMetaAccountData` is prefixed with an 8-byte account discriminator and a 4-byte
// length before the extra account meta list itself.
const EXTRA_ACCOUNT_METAS_ACCOUNT_DATA_PREFIX_SIZE = getU64Codec().fixedSize + getU32Codec().fixedSize;

/**
 * Unpacks a transfer hook validation account and parses its data into the list of
 * `ExtraAccountMeta`s configured for the mint.
 */
export function getExtraAccountMetas(data: ReadonlyUint8Array): ExtraAccountMeta[] {
    const extraAccountsList = getExtraAccountMetaListCodec().decode(data.slice(EXTRA_ACCOUNT_METAS_ACCOUNT_DATA_PREFIX_SIZE));
    return extraAccountsList.extraAccounts.slice(0, extraAccountsList.count);
}
