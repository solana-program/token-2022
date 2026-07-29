import {
    AccountRole,
    addDecoderSizePrefix,
    addEncoderSizePrefix,
    combineCodec,
    createDecoder,
    downgradeRoleToNonSigner,
    downgradeRoleToReadonly,
    fetchEncodedAccount,
    fixDecoderSize,
    fixEncoderSize,
    getAddressDecoder,
    getAddressEncoder,
    getArrayDecoder,
    getArrayEncoder,
    getBooleanDecoder,
    getBooleanEncoder,
    getBytesDecoder,
    getBytesEncoder,
    getProgramDerivedAddress,
    getStructDecoder,
    getStructEncoder,
    getTupleDecoder,
    getTupleEncoder,
    getU32Decoder,
    getU32Encoder,
    getU64Encoder,
    getU8Decoder,
    getU8Encoder,
    getUnionDecoder,
    getUnionEncoder,
    isSignerRole,
    isWritableRole,
    mergeRoles,
    padLeftDecoder,
    padLeftEncoder,
    transformDecoder,
    transformEncoder,
    unwrapOption,
    type Address,
    type AccountMeta,
    type ClientWithRpc,
    type Codec,
    type Decoder,
    type Encoder,
    type GetAccountInfoApi,
    type Instruction,
    type ProgramDerivedAddress,
    type ReadonlyUint8Array,
    type Rpc,
    type TransactionSigner,
} from '@solana/kit';

import { fetchMint, getTransferCheckedInstruction, TOKEN_2022_PROGRAM_ADDRESS, type Extension } from './generated';

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

const PUBLIC_KEY_LENGTH = 32;

// The `addressConfig` field of an `ExtraAccountMeta` is a fixed 32-byte slot whose meaning depends
// on the meta's discriminator: a literal pubkey, a packed seed list, or a packed pubkey-data
// config. Seed and pubkey-data configs are shorter than 32 bytes and zero-padded to fill the slot.
const ADDRESS_CONFIG_SIZE = 32;

// The `ExtraAccountMeta` discriminator that flags a PDA derived off the transfer hook program.
const PROGRAM_PDA_DISCRIMINATOR = 1;
// PDAs derived off a previously resolved account use a discriminator of `128 + accountIndex`, so
// discriminators `128..255` select the account at index `discriminator - 128`.
const ACCOUNT_PDA_DISCRIMINATOR_OFFSET = 1 << 7;

/**
 * The interpreted `addressConfig` of an {@link ExtraAccountMeta}, describing how its account address
 * is derived. Mirrors the transfer hook interface's address-config discriminators:
 *
 * - `Literal`: the `addressConfig` is the account address itself.
 * - `PubkeyData`: the address is read from the instruction data or a resolved account's data.
 * - `ProgramPda`: the address is a PDA derived off the transfer hook program from `seeds`.
 * - `AccountPda`: the address is a PDA derived off a previously resolved account (at `accountIndex`)
 *   from `seeds`.
 */
export type ExtraAccountMetaConfig =
    | { __kind: 'Literal'; address: Address }
    | { __kind: 'PubkeyData'; pubkeyData: ExtraAccountMetaPubkeyData }
    | { __kind: 'ProgramPda'; seeds: ExtraAccountMetaSeed[] }
    | { __kind: 'AccountPda'; accountIndex: number; seeds: ExtraAccountMetaSeed[] };

/**
 * An `ExtraAccountMeta` as stored by a transfer hook program's validation account, with its packed
 * `addressConfig` already interpreted into an {@link ExtraAccountMetaConfig}.
 */
export type ExtraAccountMeta = {
    config: ExtraAccountMetaConfig;
    isSigner: boolean;
    isWritable: boolean;
};

// The raw on-chain layout of an `ExtraAccountMeta`, before its `addressConfig` is interpreted.
type RawExtraAccountMeta = {
    discriminator: number;
    addressConfig: ReadonlyUint8Array;
    isSigner: boolean;
    isWritable: boolean;
};

function getRawExtraAccountMetaEncoder(): Encoder<RawExtraAccountMeta> {
    return getStructEncoder([
        ['discriminator', getU8Encoder()],
        ['addressConfig', fixEncoderSize(getBytesEncoder(), ADDRESS_CONFIG_SIZE)],
        ['isSigner', getBooleanEncoder()],
        ['isWritable', getBooleanEncoder()],
    ]);
}

function getRawExtraAccountMetaDecoder(): Decoder<RawExtraAccountMeta> {
    return getStructDecoder([
        ['discriminator', getU8Decoder()],
        ['addressConfig', fixDecoderSize(getBytesDecoder(), ADDRESS_CONFIG_SIZE)],
        ['isSigner', getBooleanDecoder()],
        ['isWritable', getBooleanDecoder()],
    ]);
}

// Packs an interpreted `ExtraAccountMetaConfig` back into its raw `discriminator` + `addressConfig`.
function packAddressConfig(
    config: ExtraAccountMetaConfig,
): Pick<RawExtraAccountMeta, 'discriminator' | 'addressConfig'> {
    switch (config.__kind) {
        case 'Literal':
            return { discriminator: 0, addressConfig: getAddressEncoder().encode(config.address) };
        case 'PubkeyData':
            return {
                discriminator: 2,
                addressConfig: getExtraAccountMetaPubkeyDataEncoder().encode(config.pubkeyData),
            };
        case 'ProgramPda':
            return {
                discriminator: PROGRAM_PDA_DISCRIMINATOR,
                addressConfig: getExtraAccountMetaSeedsEncoder().encode(config.seeds),
            };
        case 'AccountPda':
            return {
                discriminator: ACCOUNT_PDA_DISCRIMINATOR_OFFSET + config.accountIndex,
                addressConfig: getExtraAccountMetaSeedsEncoder().encode(config.seeds),
            };
    }
}

// Interprets a raw `discriminator` + `addressConfig` into an `ExtraAccountMetaConfig`.
function unpackAddressConfig(discriminator: number, addressConfig: ReadonlyUint8Array): ExtraAccountMetaConfig {
    if (discriminator === 0) {
        return { __kind: 'Literal', address: getAddressDecoder().decode(addressConfig) };
    }
    if (discriminator === 2) {
        return { __kind: 'PubkeyData', pubkeyData: getExtraAccountMetaPubkeyDataDecoder().decode(addressConfig) };
    }
    if (discriminator === PROGRAM_PDA_DISCRIMINATOR) {
        return { __kind: 'ProgramPda', seeds: getExtraAccountMetaSeedsDecoder().decode(addressConfig) };
    }
    const accountIndex = discriminator - ACCOUNT_PDA_DISCRIMINATOR_OFFSET;
    if (accountIndex < 0) {
        throw new Error(`Invalid transfer hook extra account meta: unknown discriminator ${discriminator}.`);
    }
    return { __kind: 'AccountPda', accountIndex, seeds: getExtraAccountMetaSeedsDecoder().decode(addressConfig) };
}

export function getExtraAccountMetaEncoder(): Encoder<ExtraAccountMeta> {
    return transformEncoder(getRawExtraAccountMetaEncoder(), (meta: ExtraAccountMeta) => {
        const { discriminator, addressConfig } = packAddressConfig(meta.config);
        if (addressConfig.length > ADDRESS_CONFIG_SIZE) {
            throw new Error(
                `Invalid transfer hook extra account meta: encoded address config is ${addressConfig.length} bytes, ` +
                    `which exceeds the ${ADDRESS_CONFIG_SIZE}-byte limit.`,
            );
        }
        return { addressConfig, discriminator, isSigner: meta.isSigner, isWritable: meta.isWritable };
    });
}

export function getExtraAccountMetaDecoder(): Decoder<ExtraAccountMeta> {
    return transformDecoder(getRawExtraAccountMetaDecoder(), raw => ({
        config: unpackAddressConfig(raw.discriminator, raw.addressConfig),
        isSigner: raw.isSigner,
        isWritable: raw.isWritable,
    }));
}

export function getExtraAccountMetaCodec(): Codec<ExtraAccountMeta> {
    return combineCodec(getExtraAccountMetaEncoder(), getExtraAccountMetaDecoder());
}

// A transfer hook validation account is prefixed with an 8-byte account discriminator and a 4-byte
// length before the list of extra account metas itself.
const EXTRA_ACCOUNT_METAS_ACCOUNT_DATA_PREFIX_SIZE = 8 + 4;

/**
 * Encodes a list of `ExtraAccountMeta`s into a transfer hook validation account's data, skipping
 * the 8-byte account discriminator and 4-byte length prefix and writing the list's `u32` count.
 */
export function getExtraAccountMetasEncoder(): Encoder<ExtraAccountMeta[]> {
    return padLeftEncoder(
        getArrayEncoder(getExtraAccountMetaEncoder(), { size: getU32Encoder() }),
        EXTRA_ACCOUNT_METAS_ACCOUNT_DATA_PREFIX_SIZE,
    );
}

/**
 * Decodes a transfer hook validation account's data into its list of `ExtraAccountMeta`s, skipping
 * the 8-byte account discriminator and 4-byte length prefix and bounding the list by its `u32`
 * count.
 *
 * Asserts the data is at least as long as the account prefix before reading, so a malformed
 * validation account fails with a clear error rather than decoding garbage.
 */
export function getExtraAccountMetasDecoder(): Decoder<ExtraAccountMeta[]> {
    const decoder = padLeftDecoder(
        getArrayDecoder(getExtraAccountMetaDecoder(), { size: getU32Decoder() }),
        EXTRA_ACCOUNT_METAS_ACCOUNT_DATA_PREFIX_SIZE,
    );
    return createDecoder({
        ...decoder,
        read: (bytes, offset) => {
            if (bytes.length - offset < EXTRA_ACCOUNT_METAS_ACCOUNT_DATA_PREFIX_SIZE) {
                throw new Error(
                    'Invalid transfer hook validation account: data is shorter than the expected ' +
                        `${EXTRA_ACCOUNT_METAS_ACCOUNT_DATA_PREFIX_SIZE}-byte account prefix.`,
                );
            }
            return decoder.read(bytes, offset);
        },
    });
}

export function getExtraAccountMetasCodec(): Codec<ExtraAccountMeta[]> {
    return combineCodec(getExtraAccountMetasEncoder(), getExtraAccountMetasDecoder());
}

/**
 * A single entry in an `ExtraAccountMeta`'s packed seed configuration, as decoded from its
 * `addressConfig`. Mirrors the transfer hook interface's `Seed` enum, minus the `Uninitialized`
 * terminator that ends the packed list.
 *
 * A `Literal` seed carries its bytes directly, whereas the other variants reference the
 * instruction data or a previously resolved account and are resolved by {@link resolveSeeds}.
 */
export type ExtraAccountMetaSeed =
    | { __kind: 'Literal'; bytes: ReadonlyUint8Array }
    | { __kind: 'InstructionData'; index: number; length: number }
    | { __kind: 'AccountKey'; index: number }
    | { __kind: 'AccountData'; accountIndex: number; dataIndex: number; length: number };

// The transfer hook interface packs each seed as a `u8` discriminator (1-based, since `0` is the
// `Uninitialized` terminator) followed by its operands. `getUnionEncoder`/`getUnionDecoder` let us
// map the on-chain discriminators (1..4) to the variant array indices (0..3) without modelling the
// terminator as a variant: the list codec handles termination via the fixed 32-byte slot instead.
function getExtraAccountMetaSeedEncoder(): Encoder<ExtraAccountMetaSeed> {
    return getUnionEncoder(
        [
            transformEncoder(
                getTupleEncoder([getU8Encoder(), addEncoderSizePrefix(getBytesEncoder(), getU8Encoder())]),
                (seed: Extract<ExtraAccountMetaSeed, { __kind: 'Literal' }>) => [1, seed.bytes] as const,
            ),
            transformEncoder(
                getTupleEncoder([getU8Encoder(), getU8Encoder(), getU8Encoder()]),
                (seed: Extract<ExtraAccountMetaSeed, { __kind: 'InstructionData' }>) =>
                    [2, seed.index, seed.length] as const,
            ),
            transformEncoder(
                getTupleEncoder([getU8Encoder(), getU8Encoder()]),
                (seed: Extract<ExtraAccountMetaSeed, { __kind: 'AccountKey' }>) => [3, seed.index] as const,
            ),
            transformEncoder(
                getTupleEncoder([getU8Encoder(), getU8Encoder(), getU8Encoder(), getU8Encoder()]),
                (seed: Extract<ExtraAccountMetaSeed, { __kind: 'AccountData' }>) =>
                    [4, seed.accountIndex, seed.dataIndex, seed.length] as const,
            ),
        ],
        seed => {
            switch (seed.__kind) {
                case 'Literal':
                    return 0;
                case 'InstructionData':
                    return 1;
                case 'AccountKey':
                    return 2;
                case 'AccountData':
                    return 3;
            }
        },
    );
}

function getExtraAccountMetaSeedDecoder(): Decoder<ExtraAccountMetaSeed> {
    return getUnionDecoder(
        [
            transformDecoder(
                getTupleDecoder([getU8Decoder(), addDecoderSizePrefix(getBytesDecoder(), getU8Decoder())]),
                ([, bytes]): ExtraAccountMetaSeed => ({ __kind: 'Literal', bytes }),
            ),
            transformDecoder(
                getTupleDecoder([getU8Decoder(), getU8Decoder(), getU8Decoder()]),
                ([, index, length]): ExtraAccountMetaSeed => ({ __kind: 'InstructionData', index, length }),
            ),
            transformDecoder(
                getTupleDecoder([getU8Decoder(), getU8Decoder()]),
                ([, index]): ExtraAccountMetaSeed => ({ __kind: 'AccountKey', index }),
            ),
            transformDecoder(
                getTupleDecoder([getU8Decoder(), getU8Decoder(), getU8Decoder(), getU8Decoder()]),
                ([, accountIndex, dataIndex, length]): ExtraAccountMetaSeed => ({
                    __kind: 'AccountData',
                    accountIndex,
                    dataIndex,
                    length,
                }),
            ),
        ],
        // Peek the `u8` discriminator (1..4) and map it to the variant array index (0..3), throwing
        // a clear error for an unknown discriminator rather than kit's index-based one.
        (bytes, offset) => {
            const discriminator = getU8Decoder().read(bytes, offset)[0];
            if (discriminator < 1 || discriminator > 4) {
                throw new Error(`Invalid transfer hook seed: unknown discriminator ${discriminator}.`);
            }
            return discriminator - 1;
        },
    );
}

// Encodes a list of seeds, relying on the meta encoder's zero-padding to the 32-byte `addressConfig`
// slot to terminate the list: the on-chain unpacker stops at a `0` discriminator or the 32-byte
// bound, so no explicit terminator is written (which would wrongly reject a maximal 32-byte list).
function getExtraAccountMetaSeedsEncoder(): Encoder<ExtraAccountMetaSeed[]> {
    return getArrayEncoder(getExtraAccountMetaSeedEncoder(), { size: 'remainder' });
}

// Decodes a list of seeds, stopping at a `0` (`Uninitialized`) discriminator or the end of the
// (32-byte) `addressConfig` slot, mirroring the on-chain unpacker's `while i < 32` bound.
function getExtraAccountMetaSeedsDecoder(): Decoder<ExtraAccountMetaSeed[]> {
    const seedDecoder = getExtraAccountMetaSeedDecoder();
    return createDecoder({
        read: (bytes, offset) => {
            const seeds: ExtraAccountMetaSeed[] = [];
            while (offset < bytes.length && bytes[offset] !== 0) {
                const [seed, nextOffset] = seedDecoder.read(bytes, offset);
                seeds.push(seed);
                offset = nextOffset;
            }
            return [seeds, offset];
        },
    });
}

async function resolveSeed(
    seed: ExtraAccountMetaSeed,
    previousMetas: Address[],
    instructionData: ReadonlyUint8Array,
    rpc: Rpc<GetAccountInfoApi>,
): Promise<ReadonlyUint8Array> {
    switch (seed.__kind) {
        case 'Literal':
            return seed.bytes;
        case 'InstructionData':
            if (instructionData.length < seed.index + seed.length) {
                throw new Error(
                    "Invalid transfer hook seed: instruction data is shorter than the seed's declared offset/length.",
                );
            }
            return instructionData.slice(seed.index, seed.index + seed.length);
        case 'AccountKey':
            if (previousMetas.length <= seed.index) {
                throw new Error(
                    'Invalid transfer hook seed: account-key seed references an out-of-bounds account index.',
                );
            }
            return getAddressEncoder().encode(previousMetas[seed.index]);
        case 'AccountData': {
            if (previousMetas.length <= seed.accountIndex) {
                throw new Error(
                    'Invalid transfer hook seed: account-data seed references an out-of-bounds account index.',
                );
            }
            const account = await fetchEncodedAccount(rpc, previousMetas[seed.accountIndex]);
            if (!account.exists) {
                throw new Error(
                    `Invalid transfer hook seed: account ${previousMetas[seed.accountIndex]} required by an ` +
                        'account-data seed was not found.',
                );
            }
            if (account.data.length < seed.dataIndex + seed.length) {
                throw new Error(
                    "Invalid transfer hook seed: account data is shorter than the seed's declared offset/length.",
                );
            }
            return account.data.slice(seed.dataIndex, seed.dataIndex + seed.length);
        }
    }
}

/**
 * Resolves a decoded list of {@link ExtraAccountMetaSeed}s into the ordered byte segments used to
 * derive a PDA: a literal, a slice of the instruction data, a previously resolved account's key, or
 * a slice of a previously resolved account's data.
 */
export async function resolveSeeds(
    seeds: ExtraAccountMetaSeed[],
    previousMetas: Address[],
    instructionData: ReadonlyUint8Array,
    rpc: Rpc<GetAccountInfoApi>,
): Promise<ReadonlyUint8Array[]> {
    return await Promise.all(seeds.map(seed => resolveSeed(seed, previousMetas, instructionData, rpc)));
}

/**
 * An `ExtraAccountMeta`'s packed pubkey-data configuration, as decoded from its `addressConfig`.
 * Mirrors the transfer hook interface's `PubkeyData` enum: the `Address` is read either from the
 * instruction data or from a previously resolved account's data, and is resolved by
 * {@link resolvePubkeyData}.
 */
export type ExtraAccountMetaPubkeyData =
    | { __kind: 'InstructionData'; index: number }
    | { __kind: 'AccountData'; accountIndex: number; dataIndex: number };

// The pubkey-data discriminators are 1-based (`1` = instruction data, `2` = account data); `0` is
// unused by the interface. As with seeds, `getUnionEncoder`/`getUnionDecoder` map those to the
// variant array indices (0..1) so `0` and unknown discriminators throw instead of decoding.
function getExtraAccountMetaPubkeyDataEncoder(): Encoder<ExtraAccountMetaPubkeyData> {
    return getUnionEncoder(
        [
            transformEncoder(
                getTupleEncoder([getU8Encoder(), getU8Encoder()]),
                (data: Extract<ExtraAccountMetaPubkeyData, { __kind: 'InstructionData' }>) => [1, data.index] as const,
            ),
            transformEncoder(
                getTupleEncoder([getU8Encoder(), getU8Encoder(), getU8Encoder()]),
                (data: Extract<ExtraAccountMetaPubkeyData, { __kind: 'AccountData' }>) =>
                    [2, data.accountIndex, data.dataIndex] as const,
            ),
        ],
        data => (data.__kind === 'InstructionData' ? 0 : 1),
    );
}

function getExtraAccountMetaPubkeyDataDecoder(): Decoder<ExtraAccountMetaPubkeyData> {
    return getUnionDecoder(
        [
            transformDecoder(
                getTupleDecoder([getU8Decoder(), getU8Decoder()]),
                ([, index]): ExtraAccountMetaPubkeyData => ({ __kind: 'InstructionData', index }),
            ),
            transformDecoder(
                getTupleDecoder([getU8Decoder(), getU8Decoder(), getU8Decoder()]),
                ([, accountIndex, dataIndex]): ExtraAccountMetaPubkeyData => ({
                    __kind: 'AccountData',
                    accountIndex,
                    dataIndex,
                }),
            ),
        ],
        // Peek the `u8` discriminator (1..2) and map it to the variant array index (0..1), throwing
        // a clear error for a `0` or unknown discriminator rather than kit's index-based one.
        (bytes, offset) => {
            const discriminator = getU8Decoder().read(bytes, offset)[0];
            if (discriminator < 1 || discriminator > 2) {
                throw new Error(`Invalid transfer hook pubkey data: unknown discriminator ${discriminator}.`);
            }
            return discriminator - 1;
        },
    );
}

/**
 * Resolves a decoded {@link ExtraAccountMetaPubkeyData} into the actual `Address` it points to:
 * either a slice of the instruction data, or a slice of a previously resolved account's data.
 */
export async function resolvePubkeyData(
    config: ExtraAccountMetaPubkeyData,
    previousMetas: Address[],
    instructionData: ReadonlyUint8Array,
    rpc: Rpc<GetAccountInfoApi>,
): Promise<Address> {
    if (config.__kind === 'InstructionData') {
        if (instructionData.length < config.index + PUBLIC_KEY_LENGTH) {
            throw new Error(
                'Invalid transfer hook pubkey data: instruction data is too small to contain a pubkey at the ' +
                    'declared offset.',
            );
        }
        return getAddressDecoder().decode(instructionData, config.index);
    }

    if (previousMetas.length <= config.accountIndex) {
        throw new Error(
            'Invalid transfer hook pubkey data: account-data source references an out-of-bounds account index.',
        );
    }
    const account = await fetchEncodedAccount(rpc, previousMetas[config.accountIndex]);
    if (!account.exists) {
        throw new Error(
            `Invalid transfer hook pubkey data: account ${previousMetas[config.accountIndex]} was not found.`,
        );
    }
    if (account.data.length < config.dataIndex + PUBLIC_KEY_LENGTH) {
        throw new Error(
            'Invalid transfer hook pubkey data: account data is too small to contain a pubkey at the declared offset.',
        );
    }
    return getAddressDecoder().decode(account.data, config.dataIndex);
}

/** An `ExtraAccountMeta` resolved into the real account it refers to. */
export type ResolvedExtraAccountMeta = {
    address: Address;
    isSigner: boolean;
    isWritable: boolean;
};

/**
 * Resolves one `ExtraAccountMeta` (as returned by `getExtraAccountMetasDecoder`) into the real
 * account it refers to: a literal pubkey, a pubkey read via `resolvePubkeyData`, or a PDA derived
 * from `resolveSeeds` off either the transfer hook program itself or a previously resolved account.
 *
 * `previousMetas` must contain every account already resolved for this instruction, in order,
 * since seed/pubkey-data configs and `AccountPda` account-index configs can reference them.
 */
export async function resolveExtraAccountMeta(
    extraMeta: ExtraAccountMeta,
    previousMetas: Address[],
    instructionData: ReadonlyUint8Array,
    transferHookProgramAddress: Address,
    rpc: Rpc<GetAccountInfoApi>,
): Promise<ResolvedExtraAccountMeta> {
    const { config, isSigner, isWritable } = extraMeta;

    switch (config.__kind) {
        case 'Literal':
            return { address: config.address, isSigner, isWritable };
        case 'PubkeyData': {
            const address = await resolvePubkeyData(config.pubkeyData, previousMetas, instructionData, rpc);
            return { address, isSigner, isWritable };
        }
        case 'ProgramPda':
        case 'AccountPda': {
            let programAddress: Address;
            if (config.__kind === 'ProgramPda') {
                programAddress = transferHookProgramAddress;
            } else {
                if (previousMetas.length <= config.accountIndex) {
                    throw new Error(
                        'Invalid transfer hook extra account meta: account-index config references an ' +
                            'out-of-bounds account index.',
                    );
                }
                programAddress = previousMetas[config.accountIndex];
            }
            const seeds = await resolveSeeds(config.seeds, previousMetas, instructionData, rpc);
            const [address] = await getProgramDerivedAddress({ programAddress, seeds });
            return { address, isSigner, isWritable };
        }
    }
}

function accountRoleFromBooleans(isSigner: boolean, isWritable: boolean): AccountRole {
    if (isSigner && isWritable) return AccountRole.WRITABLE_SIGNER;
    if (isSigner) return AccountRole.READONLY_SIGNER;
    if (isWritable) return AccountRole.WRITABLE;
    return AccountRole.READONLY;
}

/**
 * De-escalates `accountMeta`'s role to match the highest privileges already granted to the same
 * address elsewhere in `accountMetas`, so a transfer hook's extra account never claims signer or
 * writable status beyond what the transaction already grants that address.
 *
 * Mirrors the legacy `deEscalateAccountMeta`, adapted from `isSigner`/`isWritable` booleans to
 * kit's `AccountRole`.
 */
export function deEscalateAccountMeta(
    accountMeta: AccountMeta<Address>,
    accountMetas: readonly AccountMeta<Address>[],
): AccountMeta<Address> {
    const highestExistingRole = accountMetas
        .filter(x => x.address === accountMeta.address)
        .reduce<AccountRole | undefined>((acc, x) => (acc === undefined ? x.role : mergeRoles(acc, x.role)), undefined);

    if (highestExistingRole === undefined) {
        return accountMeta;
    }

    let role = accountMeta.role;
    if (!isSignerRole(highestExistingRole) && isSignerRole(role)) {
        role = downgradeRoleToNonSigner(role);
    }
    if (!isWritableRole(highestExistingRole) && isWritableRole(role)) {
        role = downgradeRoleToReadonly(role);
    }

    return { address: accountMeta.address, role };
}

const EXECUTE_INSTRUCTION_DISCRIMINATOR = new Uint8Array([105, 37, 101, 197, 75, 251, 102, 26]);

function getExecuteInstructionData(amount: bigint): ReadonlyUint8Array {
    const data = new Uint8Array(16);
    data.set(EXECUTE_INSTRUCTION_DISCRIMINATOR, 0);
    data.set(getU64Encoder().encode(amount), 8);
    return data;
}

export type ResolveExtraAccountMetasForExecuteInput = {
    rpc: Rpc<GetAccountInfoApi>;
    transferHookProgramAddress: Address;
    source: Address;
    mint: Address;
    destination: Address;
    owner: Address;
    amount: number | bigint;
    /** The transfer hook's validation account. Derived via `findExtraAccountMetaListPda` if omitted. */
    validateStatePubkey?: Address;
};

/**
 * Resolves the extra accounts a transfer hook program's `Execute` CPI needs, ready to append to
 * a `transferChecked`-family instruction: each configured extra account (resolved and
 * de-escalated against the transfer's base accounts and each other), followed by the transfer
 * hook program and its validation account.
 *
 * Returns an empty array if the mint has no transfer hook validation account, mirroring the
 * legacy `addExtraAccountMetasForExecute`'s no-op when none is configured.
 *
 * Mirrors legacy's `addExtraAccountMetasForExecute`, adapted from mutating a
 * `TransactionInstruction`'s `keys` array to returning the additional `AccountMeta`s for the
 * caller to append, since kit instructions are immutable.
 */
export async function resolveExtraAccountMetasForExecute(
    input: ResolveExtraAccountMetasForExecuteInput,
): Promise<AccountMeta<Address>[]> {
    const [validateStatePubkey] = input.validateStatePubkey
        ? [input.validateStatePubkey]
        : await findExtraAccountMetaListPda({ mint: input.mint }, { programAddress: input.transferHookProgramAddress });

    const validateStateAccount = await fetchEncodedAccount(input.rpc, validateStatePubkey);
    if (!validateStateAccount.exists) {
        return [];
    }

    const validateStateData = getExtraAccountMetasDecoder().decode(validateStateAccount.data);
    const instructionData = getExecuteInstructionData(BigInt(input.amount));

    const baseMetas: AccountMeta<Address>[] = [
        input.source,
        input.mint,
        input.destination,
        input.owner,
        validateStatePubkey,
    ].map(address => ({ address, role: AccountRole.READONLY }));
    const previousAddresses: Address[] = baseMetas.map(meta => meta.address);
    const resolvedMetas: AccountMeta<Address>[] = [];

    for (const extraAccountMeta of validateStateData) {
        const resolved = await resolveExtraAccountMeta(
            extraAccountMeta,
            previousAddresses,
            instructionData,
            input.transferHookProgramAddress,
            input.rpc,
        );
        const role = accountRoleFromBooleans(resolved.isSigner, resolved.isWritable);
        const deEscalated = deEscalateAccountMeta({ address: resolved.address, role }, [
            ...baseMetas,
            ...resolvedMetas,
        ]);
        resolvedMetas.push(deEscalated);
        previousAddresses.push(resolved.address);
    }

    return [
        ...resolvedMetas,
        { address: input.transferHookProgramAddress, role: AccountRole.READONLY },
        { address: validateStatePubkey, role: AccountRole.READONLY },
    ];
}

export type TransferCheckedWithTransferHookInstructionAsyncInput = {
    /** The source account. */
    source: Address;
    /** The token mint. */
    mint: Address;
    /** The destination account. */
    destination: Address;
    /** The source account's owner/delegate, or its multisignature account. */
    authority: Address | TransactionSigner;
    amount: number | bigint;
    decimals: number;
    /** The signer accounts for a multisignature authority. */
    multiSigners?: TransactionSigner[];
};

export type TransferCheckedWithTransferHookInstructionAsyncConfig = {
    /** The token program the mint belongs to. Defaults to Token-2022. */
    tokenProgram?: Address;
};

/**
 * Builds a `transferChecked` instruction for `mint`, appending the extra accounts its transfer hook
 * program's `Execute` CPI needs when the mint has the transfer hook extension configured.
 *
 * Fetches the mint to discover whether a transfer hook is set and, if so, its program address, then
 * resolves and de-escalates the extra accounts (via `resolveExtraAccountMetasForExecute`) and
 * appends them, followed by the hook program and its validation account. When the mint has no
 * transfer hook the returned instruction is a plain `transferChecked`.
 *
 * The transfer hook branch is only exercised for Token-2022 mints. When `tokenProgram` points at
 * the classic Token program, the mint has no extensions and this returns a plain `transferChecked`.
 *
 * Mirrors the legacy `createTransferCheckedWithTransferHookInstruction`, adapted to `@solana/kit`.
 */
export async function getTransferCheckedWithTransferHookInstructionAsync(
    client: ClientWithRpc<GetAccountInfoApi>,
    input: TransferCheckedWithTransferHookInstructionAsyncInput,
    config?: TransferCheckedWithTransferHookInstructionAsyncConfig,
): Promise<Instruction> {
    const programAddress = config?.tokenProgram ?? TOKEN_2022_PROGRAM_ADDRESS;
    const instruction = getTransferCheckedInstruction(
        {
            amount: input.amount,
            authority: input.authority,
            decimals: input.decimals,
            destination: input.destination,
            mint: input.mint,
            multiSigners: input.multiSigners,
            source: input.source,
        },
        { programAddress },
    );

    const { data: mint } = await fetchMint(client.rpc, input.mint);
    const transferHook = (unwrapOption(mint.extensions) ?? []).find(
        (extension): extension is Extract<Extension, { __kind: 'TransferHook' }> => extension.__kind === 'TransferHook',
    );
    if (!transferHook) {
        return instruction;
    }

    const owner = typeof input.authority === 'string' ? input.authority : input.authority.address;
    const extraMetas = await resolveExtraAccountMetasForExecute({
        amount: input.amount,
        destination: input.destination,
        mint: input.mint,
        owner,
        rpc: client.rpc,
        source: input.source,
        transferHookProgramAddress: transferHook.programId,
    });

    return { ...instruction, accounts: [...instruction.accounts, ...extraMetas] };
}
