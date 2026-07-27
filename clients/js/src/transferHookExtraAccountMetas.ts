import {
    fetchEncodedAccount,
    fixCodecSize,
    getAddressDecoder,
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
    type GetAccountInfoApi,
    type ProgramDerivedAddress,
    type ReadonlyUint8Array,
    type Rpc,
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
    const extraAccountsList = getExtraAccountMetaListCodec().decode(
        data.slice(EXTRA_ACCOUNT_METAS_ACCOUNT_DATA_PREFIX_SIZE),
    );
    return extraAccountsList.extraAccounts.slice(0, extraAccountsList.count);
}

const PUBLIC_KEY_LENGTH = 32;

type Seed = {
    data: ReadonlyUint8Array;
    packedLength: number;
};

function unpackSeedLiteral(seed: ReadonlyUint8Array): Seed {
    if (seed.length < 1) {
        throw new Error('Invalid transfer hook seed: literal seed is missing its length byte.');
    }
    const length = seed[0];
    const rest = seed.slice(1);
    if (rest.length < length) {
        throw new Error("Invalid transfer hook seed: literal seed's data is shorter than its declared length.");
    }
    return {
        data: rest.slice(0, length),
        // discriminator (1) + length (1) + the literal bytes themselves.
        packedLength: 2 + length,
    };
}

function unpackSeedInstructionArg(seed: ReadonlyUint8Array, instructionData: ReadonlyUint8Array): Seed {
    if (seed.length < 2) {
        throw new Error('Invalid transfer hook seed: instruction-arg seed is missing its offset/length bytes.');
    }
    const [index, length] = seed;
    if (instructionData.length < index + length) {
        throw new Error(
            "Invalid transfer hook seed: instruction data is shorter than the seed's declared offset/length.",
        );
    }
    return {
        data: instructionData.slice(index, index + length),
        // discriminator (1) + offset (1) + length (1).
        packedLength: 3,
    };
}

function unpackSeedAccountKey(seed: ReadonlyUint8Array, previousMetas: Address[]): Seed {
    if (seed.length < 1) {
        throw new Error('Invalid transfer hook seed: account-key seed is missing its index byte.');
    }
    const [index] = seed;
    if (previousMetas.length <= index) {
        throw new Error('Invalid transfer hook seed: account-key seed references an out-of-bounds account index.');
    }
    return {
        data: getAddressEncoder().encode(previousMetas[index]),
        // discriminator (1) + account index (1).
        packedLength: 2,
    };
}

async function unpackSeedAccountData(
    seed: ReadonlyUint8Array,
    previousMetas: Address[],
    rpc: Rpc<GetAccountInfoApi>,
): Promise<Seed> {
    if (seed.length < 3) {
        throw new Error('Invalid transfer hook seed: account-data seed is missing its account/offset/length bytes.');
    }
    const [accountIndex, dataOffset, length] = seed;
    if (previousMetas.length <= accountIndex) {
        throw new Error('Invalid transfer hook seed: account-data seed references an out-of-bounds account index.');
    }
    const account = await fetchEncodedAccount(rpc, previousMetas[accountIndex]);
    if (!account.exists) {
        throw new Error(
            `Invalid transfer hook seed: account ${previousMetas[accountIndex]} required by an account-data ` +
                'seed was not found.',
        );
    }
    if (account.data.length < dataOffset + length) {
        throw new Error("Invalid transfer hook seed: account data is shorter than the seed's declared offset/length.");
    }
    return {
        data: account.data.slice(dataOffset, dataOffset + length),
        // discriminator (1) + account index (1) + data offset (1) + length (1).
        packedLength: 4,
    };
}

async function unpackFirstSeed(
    seeds: ReadonlyUint8Array,
    previousMetas: Address[],
    instructionData: ReadonlyUint8Array,
    rpc: Rpc<GetAccountInfoApi>,
): Promise<Seed | null> {
    const discriminator = seeds[0];
    const remaining = seeds.slice(1);
    switch (discriminator) {
        case 0:
            return null;
        case 1:
            return unpackSeedLiteral(remaining);
        case 2:
            return unpackSeedInstructionArg(remaining, instructionData);
        case 3:
            return unpackSeedAccountKey(remaining, previousMetas);
        case 4:
            return await unpackSeedAccountData(remaining, previousMetas, rpc);
        default:
            throw new Error(`Invalid transfer hook seed: unknown discriminator ${discriminator}.`);
    }
}

/**
 * Resolves an `ExtraAccountMeta`'s packed seed configuration (its `addressConfig`, for a PDA
 * address config) into the ordered list of byte segments used to derive the account's PDA.
 *
 * Mirrors the transfer hook interface's `Seed` enum: a literal, a slice of the instruction
 * data, a previously resolved account's key, or a slice of a previously resolved account's data.
 */
export async function unpackSeeds(
    seeds: ReadonlyUint8Array,
    previousMetas: Address[],
    instructionData: ReadonlyUint8Array,
    rpc: Rpc<GetAccountInfoApi>,
): Promise<ReadonlyUint8Array[]> {
    const unpackedSeeds: ReadonlyUint8Array[] = [];
    let i = 0;
    while (i < 32) {
        const seed = await unpackFirstSeed(seeds.slice(i), previousMetas, instructionData, rpc);
        if (seed == null) {
            break;
        }
        unpackedSeeds.push(seed.data);
        i += seed.packedLength;
    }
    return unpackedSeeds;
}

function unpackPubkeyDataFromInstructionData(
    remaining: ReadonlyUint8Array,
    instructionData: ReadonlyUint8Array,
): Address {
    if (remaining.length < 1) {
        throw new Error('Invalid transfer hook pubkey data: instruction-data source is missing its offset byte.');
    }
    const dataIndex = remaining[0];
    if (instructionData.length < dataIndex + PUBLIC_KEY_LENGTH) {
        throw new Error(
            'Invalid transfer hook pubkey data: instruction data is too small to contain a pubkey at the ' +
                'declared offset.',
        );
    }
    return getAddressDecoder().decode(instructionData, dataIndex);
}

async function unpackPubkeyDataFromAccountData(
    remaining: ReadonlyUint8Array,
    previousMetas: Address[],
    rpc: Rpc<GetAccountInfoApi>,
): Promise<Address> {
    if (remaining.length < 2) {
        throw new Error('Invalid transfer hook pubkey data: account-data source is missing its account/offset bytes.');
    }
    const [accountIndex, dataIndex] = remaining;
    if (previousMetas.length <= accountIndex) {
        throw new Error(
            'Invalid transfer hook pubkey data: account-data source references an out-of-bounds account index.',
        );
    }
    const account = await fetchEncodedAccount(rpc, previousMetas[accountIndex]);
    if (!account.exists) {
        throw new Error(`Invalid transfer hook pubkey data: account ${previousMetas[accountIndex]} was not found.`);
    }
    if (account.data.length < dataIndex + PUBLIC_KEY_LENGTH) {
        throw new Error(
            'Invalid transfer hook pubkey data: account data is too small to contain a pubkey at the declared offset.',
        );
    }
    return getAddressDecoder().decode(account.data, dataIndex);
}

/**
 * Resolves an `ExtraAccountMeta`'s packed pubkey-data config (its `addressConfig`, for a
 * literal-pubkey address config) into the actual `Address` it points to: either a slice of the
 * instruction data, or a slice of a previously resolved account's data.
 */
export async function unpackPubkeyData(
    keyDataConfig: ReadonlyUint8Array,
    previousMetas: Address[],
    instructionData: ReadonlyUint8Array,
    rpc: Rpc<GetAccountInfoApi>,
): Promise<Address> {
    const discriminator = keyDataConfig[0];
    const remaining = keyDataConfig.slice(1);
    switch (discriminator) {
        case 1:
            return unpackPubkeyDataFromInstructionData(remaining, instructionData);
        case 2:
            return await unpackPubkeyDataFromAccountData(remaining, previousMetas, rpc);
        default:
            throw new Error(`Invalid transfer hook pubkey data: unknown discriminator ${discriminator}.`);
    }
}

/** An `ExtraAccountMeta` resolved into the real account it refers to. */
export type ResolvedExtraAccountMeta = {
    address: Address;
    isSigner: boolean;
    isWritable: boolean;
};

const EXTRA_ACCOUNT_META_ACCOUNT_INDEX_DISCRIMINATOR_OFFSET = 1 << 7;

/**
 * Resolves one `ExtraAccountMeta` (as returned by `getExtraAccountMetas`) into the real account
 * it refers to: a literal pubkey, a pubkey read via `unpackPubkeyData`, or a PDA derived from
 * `unpackSeeds` off either the transfer hook program itself or a previously resolved account.
 *
 * `previousMetas` must contain every account already resolved for this instruction, in order,
 * since seed/pubkey-data configs and PDA-owner account-index configs can reference them.
 */
export async function resolveExtraAccountMeta(
    extraMeta: ExtraAccountMeta,
    previousMetas: Address[],
    instructionData: ReadonlyUint8Array,
    transferHookProgramAddress: Address,
    rpc: Rpc<GetAccountInfoApi>,
): Promise<ResolvedExtraAccountMeta> {
    const { isSigner, isWritable } = extraMeta;

    if (extraMeta.discriminator === 0) {
        return { address: getAddressDecoder().decode(extraMeta.addressConfig), isSigner, isWritable };
    }

    if (extraMeta.discriminator === 2) {
        const address = await unpackPubkeyData(extraMeta.addressConfig, previousMetas, instructionData, rpc);
        return { address, isSigner, isWritable };
    }

    let programAddress: Address;
    if (extraMeta.discriminator === 1) {
        programAddress = transferHookProgramAddress;
    } else {
        const accountIndex = extraMeta.discriminator - EXTRA_ACCOUNT_META_ACCOUNT_INDEX_DISCRIMINATOR_OFFSET;
        if (accountIndex < 0 || previousMetas.length <= accountIndex) {
            throw new Error(
                'Invalid transfer hook extra account meta: discriminator ' +
                    `${extraMeta.discriminator} references an out-of-bounds account index.`,
            );
        }
        programAddress = previousMetas[accountIndex];
    }

    const seeds = await unpackSeeds(extraMeta.addressConfig, previousMetas, instructionData, rpc);
    const [address] = await getProgramDerivedAddress({ programAddress, seeds });

    return { address, isSigner, isWritable };
}
