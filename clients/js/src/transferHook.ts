import {
    type Account,
    AccountRole,
    type AccountMeta,
    type Address,
    assertAccountExists,
    combineCodec,
    decodeAccount,
    downgradeRoleToNonSigner,
    downgradeRoleToReadonly,
    type EncodedAccount,
    type FetchAccountConfig,
    fetchEncodedAccount,
    type FixedSizeCodec,
    type FixedSizeDecoder,
    type FixedSizeEncoder,
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
    getU32Decoder,
    getU32Encoder,
    getU64Decoder,
    getU64Encoder,
    getU8Decoder,
    getU8Encoder,
    type GetAccountInfoApi,
    getUtf8Encoder,
    type Instruction,
    isSignerRole,
    isSome,
    isWritableRole,
    type MaybeAccount,
    type MaybeEncodedAccount,
    type ProgramDerivedAddress,
    type ReadonlyUint8Array,
    type Rpc,
    transformEncoder,
    upgradeRoleToSigner,
    type VariableSizeCodec,
    type VariableSizeDecoder,
    type VariableSizeEncoder,
} from '@solana/kit';
import {
    fetchMint,
    getTransferCheckedInstruction,
    getTransferCheckedWithFeeInstruction,
    type Mint,
    type TransferCheckedInput,
    type TransferCheckedWithFeeInput,
} from './generated';

const DEFAULT_ADDRESS = '11111111111111111111111111111111' as Address<'11111111111111111111111111111111'>;
const EXTERNAL_PDA_DISCRIMINATOR_OFFSET = 1 << 7;
const EXTRA_ACCOUNT_METAS_SEED = 'extra-account-metas';
const PUBKEY_LENGTH = 32;

function roleFromFlags(isSigner: boolean, isWritable: boolean): AccountRole {
    const role = isWritable ? AccountRole.WRITABLE : AccountRole.READONLY;
    return isSigner ? upgradeRoleToSigner(role) : role;
}

async function fetchAccountData(
    rpc: Rpc<GetAccountInfoApi>,
    address: Address,
    config?: FetchAccountConfig,
): Promise<ReadonlyUint8Array> {
    const account = await fetchEncodedAccount(rpc, address, config);
    assertAccountExists(account);
    return account.data;
}

async function unpackSeeds(
    seedsConfig: ReadonlyUint8Array,
    previousMetas: AccountMeta[],
    instructionData: ReadonlyUint8Array,
    rpc: Rpc<GetAccountInfoApi>,
    config?: FetchAccountConfig,
): Promise<ReadonlyUint8Array[]> {
    const seeds: ReadonlyUint8Array[] = [];
    let i = 0;
    while (i < seedsConfig.length) {
        const discriminator = seedsConfig[i];
        const rest = seedsConfig.subarray(i + 1);
        if (discriminator === 0) {
            break;
        } else if (discriminator === 1) {
            if (rest.length < 1) throw new Error('Invalid transfer hook literal seed.');
            const length = rest[0];
            if (rest.length < 1 + length) throw new Error('Invalid transfer hook literal seed.');
            seeds.push(rest.subarray(1, 1 + length));
            i += 2 + length;
        } else if (discriminator === 2) {
            if (rest.length < 2) throw new Error('Invalid transfer hook instruction data seed.');
            const [index, length] = [rest[0], rest[1]];
            if (instructionData.length < index + length) {
                throw new Error('Invalid transfer hook instruction data seed.');
            }
            seeds.push(instructionData.subarray(index, index + length));
            i += 3;
        } else if (discriminator === 3) {
            if (rest.length < 1) throw new Error('Invalid transfer hook account key seed.');
            const index = rest[0];
            if (previousMetas.length <= index) throw new Error('Invalid transfer hook account key seed.');
            seeds.push(getAddressEncoder().encode(previousMetas[index].address));
            i += 2;
        } else if (discriminator === 4) {
            if (rest.length < 3) throw new Error('Invalid transfer hook account data seed.');
            const [accountIndex, dataIndex, length] = [rest[0], rest[1], rest[2]];
            if (previousMetas.length <= accountIndex) {
                throw new Error('Invalid transfer hook account data seed.');
            }
            const data = await fetchAccountData(rpc, previousMetas[accountIndex].address, config);
            if (data.length < dataIndex + length) throw new Error('Invalid transfer hook account data seed.');
            seeds.push(data.subarray(dataIndex, dataIndex + length));
            i += 4;
        } else {
            throw new Error(`Invalid transfer hook seed discriminator ${discriminator}.`);
        }
    }
    return seeds;
}

async function unpackPubkeyData(
    keyDataConfig: ReadonlyUint8Array,
    previousMetas: AccountMeta[],
    instructionData: ReadonlyUint8Array,
    rpc: Rpc<GetAccountInfoApi>,
    config?: FetchAccountConfig,
): Promise<Address> {
    const discriminator = keyDataConfig[0];
    const rest = keyDataConfig.subarray(1);
    if (discriminator === 1) {
        const dataIndex = rest[0];
        if (instructionData.length < dataIndex + PUBKEY_LENGTH) {
            throw new Error('Transfer hook pubkey data too small.');
        }
        return getAddressDecoder().decode(instructionData.subarray(dataIndex, dataIndex + PUBKEY_LENGTH));
    }
    if (discriminator === 2) {
        const [accountIndex, dataIndex] = [rest[0], rest[1]];
        if (previousMetas.length <= accountIndex) {
            throw new Error('Transfer hook pubkey data account not found.');
        }
        const data = await fetchAccountData(rpc, previousMetas[accountIndex].address, config);
        if (data.length < dataIndex + PUBKEY_LENGTH) {
            throw new Error('Transfer hook pubkey data too small.');
        }
        return getAddressDecoder().decode(data.subarray(dataIndex, dataIndex + PUBKEY_LENGTH));
    }
    throw new Error(`Invalid transfer hook pubkey data discriminator ${discriminator}.`);
}

function deEscalateAccountMeta(accountMeta: AccountMeta, accountMetas: AccountMeta[]): AccountMeta {
    const matching = accountMetas.filter(meta => meta.address === accountMeta.address);
    if (matching.length === 0) return accountMeta;
    let role = accountMeta.role;
    if (!matching.some(meta => isSignerRole(meta.role))) role = downgradeRoleToNonSigner(role);
    if (!matching.some(meta => isWritableRole(meta.role))) role = downgradeRoleToReadonly(role);
    return { ...accountMeta, role };
}

function getOwnerAddress(authority: TransferCheckedInput['authority']): Address {
    return typeof authority === 'string' ? authority : authority.address;
}

async function addTransferHookAccountsToInstruction<TInstruction extends Instruction>(
    rpc: Rpc<GetAccountInfoApi>,
    instruction: TInstruction,
    input: {
        amount: bigint | number;
        authority: TransferCheckedInput['authority'];
        destination: Address;
        mint: Address;
        source: Address;
    },
    config?: FetchAccountConfig,
): Promise<TInstruction> {
    const mint = await fetchMint(rpc, input.mint, config);
    const transferHookProgramId = getTransferHookProgramId(mint);
    if (!transferHookProgramId) {
        return instruction;
    }
    return await addExtraAccountMetasForExecute(
        rpc,
        instruction,
        transferHookProgramId,
        {
            amount: input.amount,
            destination: input.destination,
            mint: input.mint,
            owner: getOwnerAddress(input.authority),
            source: input.source,
        },
        config,
    );
}

/**
 * The discriminator of the transfer hook interface's `Execute` instruction:
 * `sha256("spl-transfer-hook-interface:execute")[0..8]`.
 */
export const EXECUTE_DISCRIMINATOR: ReadonlyUint8Array = new Uint8Array([105, 37, 101, 197, 75, 251, 102, 26]);

export function getExecuteDiscriminatorBytes(): ReadonlyUint8Array {
    return fixEncoderSize(getBytesEncoder(), 8).encode(EXECUTE_DISCRIMINATOR);
}

/** The data of the transfer hook interface's `Execute` instruction. */
export type ExecuteInstructionData = {
    discriminator: ReadonlyUint8Array;
    amount: bigint;
};

export type ExecuteInstructionDataArgs = {
    amount: bigint | number;
};

export function getExecuteInstructionDataEncoder(): FixedSizeEncoder<ExecuteInstructionDataArgs> {
    return transformEncoder(
        getStructEncoder([
            ['discriminator', fixEncoderSize(getBytesEncoder(), 8)],
            ['amount', getU64Encoder()],
        ]),
        value => ({ ...value, discriminator: EXECUTE_DISCRIMINATOR }),
    );
}

export function getExecuteInstructionDataDecoder(): FixedSizeDecoder<ExecuteInstructionData> {
    return getStructDecoder([
        ['discriminator', fixDecoderSize(getBytesDecoder(), 8)],
        ['amount', getU64Decoder()],
    ]);
}

export function getExecuteInstructionDataCodec(): FixedSizeCodec<ExecuteInstructionDataArgs, ExecuteInstructionData> {
    return combineCodec(getExecuteInstructionDataEncoder(), getExecuteInstructionDataDecoder());
}

/** An additional account required by a transfer hook, as stored in the validation account. */
export type ExtraAccountMeta = {
    /**
     * How to resolve the address: 0 = literal key, 1 = PDA off the hook program,
     * 2 = pubkey data, 128+ = PDA off the program at account index `discriminator - 128`.
     */
    discriminator: number;
    /** 32 bytes of configuration data, interpreted according to the discriminator. */
    addressConfig: ReadonlyUint8Array;
    isSigner: boolean;
    isWritable: boolean;
};

/** The data of a validation account, listing the extra accounts required by a transfer hook. */
export type ExtraAccountMetaAccountData = {
    instructionDiscriminator: bigint;
    /** The length, in bytes, of the extra account meta list. */
    length: number;
    extraAccountMetas: ExtraAccountMeta[];
};

export type ExtraAccountMetaAccountDataArgs = {
    instructionDiscriminator: bigint | number;
    /** The length, in bytes, of the extra account meta list. */
    length: number;
    extraAccountMetas: ExtraAccountMeta[];
};

export function getExtraAccountMetaEncoder(): FixedSizeEncoder<ExtraAccountMeta> {
    return getStructEncoder([
        ['discriminator', getU8Encoder()],
        ['addressConfig', fixEncoderSize(getBytesEncoder(), PUBKEY_LENGTH)],
        ['isSigner', getBooleanEncoder()],
        ['isWritable', getBooleanEncoder()],
    ]);
}

export function getExtraAccountMetaDecoder(): FixedSizeDecoder<ExtraAccountMeta> {
    return getStructDecoder([
        ['discriminator', getU8Decoder()],
        ['addressConfig', fixDecoderSize(getBytesDecoder(), PUBKEY_LENGTH)],
        ['isSigner', getBooleanDecoder()],
        ['isWritable', getBooleanDecoder()],
    ]);
}

export function getExtraAccountMetaCodec(): FixedSizeCodec<ExtraAccountMeta> {
    return combineCodec(getExtraAccountMetaEncoder(), getExtraAccountMetaDecoder());
}

export function getExtraAccountMetaAccountDataEncoder(): VariableSizeEncoder<ExtraAccountMetaAccountDataArgs> {
    return getStructEncoder([
        ['instructionDiscriminator', getU64Encoder()],
        ['length', getU32Encoder()],
        ['extraAccountMetas', getArrayEncoder(getExtraAccountMetaEncoder(), { size: getU32Encoder() })],
    ]);
}

export function getExtraAccountMetaAccountDataDecoder(): VariableSizeDecoder<ExtraAccountMetaAccountData> {
    return getStructDecoder([
        ['instructionDiscriminator', getU64Decoder()],
        ['length', getU32Decoder()],
        ['extraAccountMetas', getArrayDecoder(getExtraAccountMetaDecoder(), { size: getU32Decoder() })],
    ]);
}

export function getExtraAccountMetaAccountDataCodec(): VariableSizeCodec<
    ExtraAccountMetaAccountDataArgs,
    ExtraAccountMetaAccountData
> {
    return combineCodec(getExtraAccountMetaAccountDataEncoder(), getExtraAccountMetaAccountDataDecoder());
}

export type ExtraAccountMetasSeeds = {
    /** The mint of the token whose transfers invoke the hook. */
    mint: Address;
};

/** Derives the address of the validation account that stores a mint's extra account metas. */
export async function findExtraAccountMetasPda(
    seeds: ExtraAccountMetasSeeds,
    config: { programAddress: Address },
): Promise<ProgramDerivedAddress> {
    return await getProgramDerivedAddress({
        programAddress: config.programAddress,
        seeds: [getUtf8Encoder().encode(EXTRA_ACCOUNT_METAS_SEED), getAddressEncoder().encode(seeds.mint)],
    });
}

export function decodeExtraAccountMetaList<TAddress extends string = string>(
    encodedAccount: EncodedAccount<TAddress>,
): Account<ExtraAccountMetaAccountData, TAddress>;
export function decodeExtraAccountMetaList<TAddress extends string = string>(
    encodedAccount: MaybeEncodedAccount<TAddress>,
): MaybeAccount<ExtraAccountMetaAccountData, TAddress>;
export function decodeExtraAccountMetaList<TAddress extends string = string>(
    encodedAccount: EncodedAccount<TAddress> | MaybeEncodedAccount<TAddress>,
): Account<ExtraAccountMetaAccountData, TAddress> | MaybeAccount<ExtraAccountMetaAccountData, TAddress> {
    return decodeAccount(encodedAccount as MaybeEncodedAccount<TAddress>, getExtraAccountMetaAccountDataDecoder());
}

export async function fetchExtraAccountMetaList<TAddress extends string = string>(
    rpc: Parameters<typeof fetchEncodedAccount>[0],
    address: Address<TAddress>,
    config?: FetchAccountConfig,
): Promise<Account<ExtraAccountMetaAccountData, TAddress>> {
    const maybeAccount = await fetchMaybeExtraAccountMetaList(rpc, address, config);
    assertAccountExists(maybeAccount);
    return maybeAccount;
}

export async function fetchMaybeExtraAccountMetaList<TAddress extends string = string>(
    rpc: Parameters<typeof fetchEncodedAccount>[0],
    address: Address<TAddress>,
    config?: FetchAccountConfig,
): Promise<MaybeAccount<ExtraAccountMetaAccountData, TAddress>> {
    const maybeAccount = await fetchEncodedAccount(rpc, address, config);
    return decodeExtraAccountMetaList(maybeAccount);
}

/**
 * Resolves a single `ExtraAccountMeta` into a concrete `AccountMeta`, given the
 * metas resolved so far and the data of the instruction being executed.
 */
export async function resolveExtraAccountMeta(
    rpc: Rpc<GetAccountInfoApi>,
    extraMeta: ExtraAccountMeta,
    previousMetas: AccountMeta[],
    instructionData: ReadonlyUint8Array,
    transferHookProgramId: Address,
    config?: FetchAccountConfig,
): Promise<AccountMeta> {
    const role = roleFromFlags(extraMeta.isSigner, extraMeta.isWritable);
    if (extraMeta.discriminator === 0) {
        return { address: getAddressDecoder().decode(extraMeta.addressConfig), role };
    }
    if (extraMeta.discriminator === 2) {
        const address = await unpackPubkeyData(extraMeta.addressConfig, previousMetas, instructionData, rpc, config);
        return { address, role };
    }

    let programAddress: Address;
    if (extraMeta.discriminator === 1) {
        programAddress = transferHookProgramId;
    } else if (extraMeta.discriminator >= EXTERNAL_PDA_DISCRIMINATOR_OFFSET) {
        const accountIndex = extraMeta.discriminator - EXTERNAL_PDA_DISCRIMINATOR_OFFSET;
        if (previousMetas.length <= accountIndex) {
            throw new Error('Transfer hook extra account not found.');
        }
        programAddress = previousMetas[accountIndex].address;
    } else {
        throw new Error(`Invalid transfer hook extra account discriminator ${extraMeta.discriminator}.`);
    }

    const seeds = await unpackSeeds(extraMeta.addressConfig, previousMetas, instructionData, rpc, config);
    const [address] = await getProgramDerivedAddress({ programAddress, seeds });
    return { address, role };
}

export type ExecuteInput = {
    amount: bigint | number;
    destination: Address;
    mint: Address;
    owner: Address;
    source: Address;
};

/**
 * Builds the transfer hook interface's `Execute` instruction, without the
 * additional accounts listed in the validation account.
 */
export function getExecuteInstruction(
    input: ExecuteInput & { validationAccount: Address },
    config: { programAddress: Address },
): Instruction {
    const accounts: AccountMeta[] = [
        { address: input.source, role: AccountRole.READONLY },
        { address: input.mint, role: AccountRole.READONLY },
        { address: input.destination, role: AccountRole.READONLY },
        { address: input.owner, role: AccountRole.READONLY },
        { address: input.validationAccount, role: AccountRole.READONLY },
    ];
    return Object.freeze({
        accounts,
        data: getExecuteInstructionDataEncoder().encode({ amount: input.amount }),
        programAddress: config.programAddress,
    });
}

/**
 * Resolves the extra account metas stored in a mint's validation account and
 * returns them — followed by the transfer hook program and the validation
 * account itself — ready to be appended to a transfer instruction.
 *
 * Throws when the validation account does not exist.
 */
export async function getExtraAccountMetasForExecute(
    rpc: Rpc<GetAccountInfoApi>,
    transferHookProgramId: Address,
    input: ExecuteInput,
    config?: FetchAccountConfig,
): Promise<AccountMeta[]> {
    const [validationAddress] = await findExtraAccountMetasPda(
        { mint: input.mint },
        { programAddress: transferHookProgramId },
    );
    const validationAccount = await fetchExtraAccountMetaList(rpc, validationAddress, config);

    const instructionData = getExecuteInstructionDataEncoder().encode({ amount: input.amount });
    const executeMetas: AccountMeta[] = [
        { address: input.source, role: AccountRole.READONLY },
        { address: input.mint, role: AccountRole.READONLY },
        { address: input.destination, role: AccountRole.READONLY },
        { address: input.owner, role: AccountRole.READONLY },
        { address: validationAddress, role: AccountRole.READONLY },
    ];

    for (const extraMeta of validationAccount.data.extraAccountMetas) {
        const resolved = await resolveExtraAccountMeta(
            rpc,
            extraMeta,
            executeMetas,
            instructionData,
            transferHookProgramId,
            config,
        );
        executeMetas.push(deEscalateAccountMeta(resolved, executeMetas));
    }

    return [
        ...executeMetas.slice(5),
        { address: transferHookProgramId, role: AccountRole.READONLY },
        { address: validationAddress, role: AccountRole.READONLY },
    ];
}

/**
 * Appends the extra accounts needed by a transfer hook to a transfer
 * instruction. Throws when the mint's validation account does not exist.
 */
export async function addExtraAccountMetasForExecute<TInstruction extends Instruction>(
    rpc: Rpc<GetAccountInfoApi>,
    instruction: TInstruction,
    transferHookProgramId: Address,
    input: ExecuteInput,
    config?: FetchAccountConfig,
): Promise<TInstruction> {
    const requiredAccounts = [input.source, input.mint, input.destination, input.owner];
    const instructionAccounts = instruction.accounts ?? [];
    if (!requiredAccounts.every(address => instructionAccounts.some(meta => meta.address === address))) {
        throw new Error('Missing required account in instruction.');
    }

    const extraMetas = await getExtraAccountMetasForExecute(rpc, transferHookProgramId, input, config);
    return Object.freeze({
        ...instruction,
        accounts: [...instructionAccounts, ...extraMetas],
    });
}

/**
 * Returns the program id of the mint's active transfer hook, or `null` when the
 * mint has no transfer hook extension or the hook program is unset.
 */
export function getTransferHookProgramId(mint: Account<Mint>): Address | null {
    const extensions = mint.data.extensions;
    if (!isSome(extensions)) return null;
    const transferHook = extensions.value.find(extension => extension.__kind === 'TransferHook');
    if (!transferHook || transferHook.programId === DEFAULT_ADDRESS) return null;
    return transferHook.programId;
}

/**
 * Builds a `TransferChecked` instruction with the extra accounts required by
 * the mint's transfer hook, resolved from its validation account. Throws when
 * the mint has an active hook whose validation account does not exist.
 */
export async function getTransferCheckedWithTransferHookInstructionAsync(
    rpc: Rpc<GetAccountInfoApi>,
    input: TransferCheckedInput,
    config?: { fetchAccountConfig?: FetchAccountConfig; programAddress?: Address },
) {
    const instruction = getTransferCheckedInstruction(input, { programAddress: config?.programAddress });
    return await addTransferHookAccountsToInstruction(rpc, instruction, input, config?.fetchAccountConfig);
}

/**
 * Builds a `TransferCheckedWithFee` instruction with the extra accounts
 * required by the mint's transfer hook, resolved from its validation account.
 * Throws when the mint has an active hook whose validation account does not exist.
 */
export async function getTransferCheckedWithFeeAndTransferHookInstructionAsync(
    rpc: Rpc<GetAccountInfoApi>,
    input: TransferCheckedWithFeeInput,
    config?: { fetchAccountConfig?: FetchAccountConfig; programAddress?: Address },
) {
    const instruction = getTransferCheckedWithFeeInstruction(input, { programAddress: config?.programAddress });
    return await addTransferHookAccountsToInstruction(rpc, instruction, input, config?.fetchAccountConfig);
}
