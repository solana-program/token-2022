import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import {
    address,
    AccountRole,
    getAddressEncoder,
    getProgramDerivedAddress,
    getU64Encoder,
    lamports,
    none,
    some,
    type Address,
    type ReadonlyUint8Array,
} from '@solana/kit';
import { describe, expect, it } from 'vitest';

import {
    deEscalateAccountMeta,
    findExtraAccountMetaListPda,
    getExtraAccountMetaCodec,
    getExtraAccountMetaDecoder,
    getExtraAccountMetaEncoder,
    getExtraAccountMetasCodec,
    getExtraAccountMetasDecoder,
    getExtraAccountMetasEncoder,
    getMintEncoder,
    getTransferCheckedInstruction,
    getTransferCheckedWithTransferHookInstructionAsync,
    resolveExtraAccountMeta,
    resolveExtraAccountMetasForExecute,
    resolvePubkeyData,
    resolveSeeds,
    TOKEN_2022_PROGRAM_ADDRESS,
    type ExtraAccountMeta,
    type ExtraAccountMetaPubkeyData,
    type ExtraAccountMetaSeed,
} from '../../../src';
import { createTestClient, LiteSvmClient } from '../../_setup';

const plainAddress = address('6c5q79ccBTWvZTEx3JkdHThtMa2eALba5bfvHGf8kA2c');
const transferHookProgramId = address('7N4HggYEJAtCLJdnHGCtFqfxcB5rhQCsQTze3ftYstVj');
const mint = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

function setAccountData(svm: LiteSvmClient['svm'], accountAddress: Address, data: Uint8Array) {
    svm.setAccount({
        address: accountAddress,
        data,
        executable: false,
        lamports: lamports(1_000_000n),
        programAddress: SYSTEM_PROGRAM_ADDRESS,
        space: BigInt(data.length),
    });
}

// Injects a transfer hook validation account holding the given extra account metas, encoded with the
// same codec the resolvers decode.
function setValidationAccount(svm: LiteSvmClient['svm'], accountAddress: Address, metas: ExtraAccountMeta[]) {
    setAccountData(svm, accountAddress, new Uint8Array(getExtraAccountMetasEncoder().encode(metas)));
}

// The following two helpers build raw account bytes by hand, used only by the decode tests that must
// feed malformed or trailing data the codecs cannot produce.
function extraAccountMetaBytes(
    discriminator: number,
    addressConfig: Uint8Array,
    isSigner: boolean,
    isWritable: boolean,
) {
    return new Uint8Array([discriminator, ...addressConfig, isSigner ? 1 : 0, isWritable ? 1 : 0]);
}

function addressConfigOf(bytes: ReadonlyUint8Array): Uint8Array {
    const addressConfig = new Uint8Array(32);
    addressConfig.set(bytes, 0);
    return addressConfig;
}

it('finds the same PDA as a manual derivation off the "extra-account-metas" seed', async () => {
    const [expected] = await getProgramDerivedAddress({
        programAddress: transferHookProgramId,
        seeds: ['extra-account-metas', getAddressEncoder().encode(mint)],
    });

    const [actual] = await findExtraAccountMetaListPda({ mint }, { programAddress: transferHookProgramId });

    expect(actual).toBe(expected);
});

describe('getExtraAccountMetasDecoder', () => {
    it('parses extra account metas from validation account data, ignoring trailing bytes past count', () => {
        const addressConfig = new Uint8Array(32);
        addressConfig.set(getAddressEncoder().encode(plainAddress), 0);

        const plainExtraAccount = extraAccountMetaBytes(0, addressConfig, false, false);
        const pdaExtraAccount = extraAccountMetaBytes(1, addressConfig, true, false);

        const data = new Uint8Array([
            ...new Uint8Array(12), // u64 instructionDiscriminator + u32 length
            1,
            0,
            0,
            0, // u32 count -- only the first entry is "in bounds"
            ...plainExtraAccount,
            ...pdaExtraAccount, // trailing bytes past `count`, should be dropped
        ]);

        const parsed = getExtraAccountMetasDecoder().decode(data);

        expect(parsed).toHaveLength(1);
        expect(parsed[0]).toEqual({
            config: { __kind: 'Literal', address: plainAddress },
            isSigner: false,
            isWritable: false,
        });
    });

    it('throws when decoding validation account data shorter than the account prefix', () => {
        expect(() => getExtraAccountMetasDecoder().decode(new Uint8Array(8))).toThrow();
    });
});

describe('getExtraAccountMetaCodec', () => {
    it('round-trips a validation account with every ExtraAccountMetaConfig variant', () => {
        const codec = getExtraAccountMetasCodec();
        const metas: ExtraAccountMeta[] = [
            { config: { __kind: 'Literal', address: plainAddress }, isSigner: true, isWritable: false },
            {
                config: { __kind: 'PubkeyData', pubkeyData: { __kind: 'InstructionData', index: 8 } },
                isSigner: false,
                isWritable: true,
            },
            {
                config: {
                    __kind: 'ProgramPda',
                    seeds: [
                        { __kind: 'Literal', bytes: new Uint8Array([0xaa, 0xbb]) },
                        { __kind: 'AccountKey', index: 3 },
                    ],
                },
                isSigner: false,
                isWritable: false,
            },
            {
                config: {
                    __kind: 'AccountPda',
                    accountIndex: 5,
                    seeds: [{ __kind: 'InstructionData', index: 8, length: 8 }],
                },
                isSigner: true,
                isWritable: true,
            },
        ];

        expect(codec.decode(codec.encode(metas))).toEqual(metas);
    });

    it('round-trips a maximal seed list that fills the whole address config with no terminator', () => {
        // Two 14-byte literals pack to 2 * (1 discriminator + 1 length + 14) = 32 bytes exactly,
        // leaving no room for a `0` terminator. This mirrors the on-chain packer, which allows seeds
        // to fill all 32 bytes; the decoder must stop at the 32-byte bound rather than requiring a
        // terminator.
        const codec = getExtraAccountMetaCodec();
        const meta: ExtraAccountMeta = {
            config: {
                __kind: 'ProgramPda',
                seeds: [
                    { __kind: 'Literal', bytes: new Uint8Array(14).fill(0xaa) },
                    { __kind: 'Literal', bytes: new Uint8Array(14).fill(0xbb) },
                ],
            },
            isSigner: false,
            isWritable: false,
        };

        const encoded = codec.encode(meta);
        // discriminator (1) + addressConfig (32) + isSigner (1) + isWritable (1).
        expect(encoded).toHaveLength(35);
        expect(codec.decode(encoded)).toEqual(meta);
    });

    it('throws when encoding an ExtraAccountMeta whose packed seeds exceed the address config size', () => {
        // A single literal seed of 31 bytes packs to 1 (discriminator) + 1 (length) + 31 = 33 bytes,
        // overflowing the 32-byte address config slot.
        const meta: ExtraAccountMeta = {
            config: { __kind: 'ProgramPda', seeds: [{ __kind: 'Literal', bytes: new Uint8Array(31) }] },
            isSigner: false,
            isWritable: false,
        };

        expect(() => getExtraAccountMetaEncoder().encode(meta)).toThrow();
    });

    it('decodes a program-PDA meta with an empty seed list when its address config is all zeroes', () => {
        // Discriminator 1 (program PDA) with an all-zero address config: the seed list terminates
        // immediately, leaving no seeds.
        const meta = getExtraAccountMetaDecoder().decode(
            extraAccountMetaBytes(1, addressConfigOf(new Uint8Array()), false, false),
        );

        expect(meta.config).toEqual({ __kind: 'ProgramPda', seeds: [] });
    });

    it('throws a clear error when decoding a meta whose seed list has an unknown discriminator', () => {
        // Discriminator 1 (program PDA) whose packed seeds start with an unknown seed discriminator
        // 9. The error names the actual on-chain discriminator, not kit's internal variant index.
        expect(() =>
            getExtraAccountMetaDecoder().decode(
                extraAccountMetaBytes(1, addressConfigOf(new Uint8Array([9])), false, false),
            ),
        ).toThrow('unknown discriminator 9');
    });

    it('throws a clear error when decoding a meta whose pubkey data has an unknown discriminator', () => {
        // Discriminator 2 (pubkey data) whose config starts with an unknown pubkey-data
        // discriminator 9.
        expect(() =>
            getExtraAccountMetaDecoder().decode(
                extraAccountMetaBytes(2, addressConfigOf(new Uint8Array([9])), false, false),
            ),
        ).toThrow('unknown discriminator 9');
    });

    it('throws a clear error when decoding a meta with a discriminator in the unused 3..127 range', () => {
        // Discriminators 3..127 are neither a known kind nor an account-index PDA (which start at
        // 128), so they must be rejected as unknown rather than misreported as an out-of-bounds
        // account index.
        expect(() =>
            getExtraAccountMetaDecoder().decode(
                extraAccountMetaBytes(5, addressConfigOf(new Uint8Array()), false, false),
            ),
        ).toThrow('unknown discriminator 5');
    });
});

describe('resolveSeeds', () => {
    it('resolves a literal seed', async () => {
        const client = await createTestClient();
        const seeds: ExtraAccountMetaSeed[] = [{ __kind: 'Literal', bytes: new Uint8Array([0xaa, 0xbb, 0xcc]) }];

        const resolved = await resolveSeeds(seeds, [], new Uint8Array(), client.rpc);

        expect(resolved).toEqual([new Uint8Array([0xaa, 0xbb, 0xcc])]);
    });

    it('resolves an instruction-data seed to a slice of the instruction data', async () => {
        const client = await createTestClient();
        const instructionData = new Uint8Array([10, 20, 30, 40, 50]);
        const seeds: ExtraAccountMetaSeed[] = [{ __kind: 'InstructionData', index: 1, length: 3 }];

        const resolved = await resolveSeeds(seeds, [], instructionData, client.rpc);

        expect(resolved).toEqual([new Uint8Array([20, 30, 40])]);
    });

    it('resolves an account-key seed to a previously resolved account address', async () => {
        const client = await createTestClient();
        const seeds: ExtraAccountMetaSeed[] = [{ __kind: 'AccountKey', index: 1 }];

        const resolved = await resolveSeeds(seeds, [plainAddress, mint], new Uint8Array(), client.rpc);

        expect(resolved).toEqual([getAddressEncoder().encode(mint)]);
    });

    it('resolves an account-data seed by fetching the account over rpc', async () => {
        const client = await createTestClient();
        const accountData = new Uint8Array([0, 0, 0xde, 0xad, 0xbe, 0xef, 0, 0]);
        setAccountData(client.svm, plainAddress, accountData);
        const seeds: ExtraAccountMetaSeed[] = [{ __kind: 'AccountData', accountIndex: 0, dataIndex: 2, length: 4 }];

        const resolved = await resolveSeeds(seeds, [plainAddress], new Uint8Array(), client.rpc);

        expect(resolved).toEqual([new Uint8Array([0xde, 0xad, 0xbe, 0xef])]);
    });

    it('resolves multiple seeds in order', async () => {
        const client = await createTestClient();
        const seeds: ExtraAccountMetaSeed[] = [
            { __kind: 'Literal', bytes: new Uint8Array([0x01, 0x02]) },
            { __kind: 'AccountKey', index: 0 },
        ];

        const resolved = await resolveSeeds(seeds, [plainAddress], new Uint8Array(), client.rpc);

        expect(resolved).toEqual([new Uint8Array([0x01, 0x02]), getAddressEncoder().encode(plainAddress)]);
    });

    it('throws when an account-key seed references an out-of-bounds account index', async () => {
        const client = await createTestClient();
        const seeds: ExtraAccountMetaSeed[] = [{ __kind: 'AccountKey', index: 0 }];

        await expect(resolveSeeds(seeds, [], new Uint8Array(), client.rpc)).rejects.toThrow();
    });

    it('throws when an account-data seed references an account that does not exist', async () => {
        const client = await createTestClient();
        const seeds: ExtraAccountMetaSeed[] = [{ __kind: 'AccountData', accountIndex: 0, dataIndex: 0, length: 1 }];

        await expect(resolveSeeds(seeds, [plainAddress], new Uint8Array(), client.rpc)).rejects.toThrow();
    });
});

describe('resolvePubkeyData', () => {
    it('resolves an address from instruction data', async () => {
        const client = await createTestClient();
        const addressBytes = getAddressEncoder().encode(mint);
        const instructionData = new Uint8Array([0xff, ...addressBytes]);
        const config: ExtraAccountMetaPubkeyData = { __kind: 'InstructionData', index: 1 };

        const resolved = await resolvePubkeyData(config, [], instructionData, client.rpc);

        expect(resolved).toBe(mint);
    });

    it("resolves an address from a previously resolved account's data", async () => {
        const client = await createTestClient();
        const addressBytes = getAddressEncoder().encode(mint);
        const accountData = new Uint8Array([0xff, ...addressBytes]);
        setAccountData(client.svm, plainAddress, accountData);
        const config: ExtraAccountMetaPubkeyData = { __kind: 'AccountData', accountIndex: 0, dataIndex: 1 };

        const resolved = await resolvePubkeyData(config, [plainAddress], new Uint8Array(), client.rpc);

        expect(resolved).toBe(mint);
    });

    it('throws when instruction data is too small for a pubkey at the declared offset', async () => {
        const client = await createTestClient();
        const config: ExtraAccountMetaPubkeyData = { __kind: 'InstructionData', index: 0 };

        await expect(resolvePubkeyData(config, [], new Uint8Array(4), client.rpc)).rejects.toThrow();
    });

    it('throws when the referenced account does not exist', async () => {
        const client = await createTestClient();
        const config: ExtraAccountMetaPubkeyData = { __kind: 'AccountData', accountIndex: 0, dataIndex: 0 };

        await expect(resolvePubkeyData(config, [plainAddress], new Uint8Array(), client.rpc)).rejects.toThrow();
    });
});

describe('resolveExtraAccountMeta', () => {
    it('resolves a literal-pubkey meta', async () => {
        const client = await createTestClient();
        const meta: ExtraAccountMeta = {
            config: { __kind: 'Literal', address: plainAddress },
            isSigner: true,
            isWritable: false,
        };

        const resolved = await resolveExtraAccountMeta(meta, [], new Uint8Array(), transferHookProgramId, client.rpc);

        expect(resolved).toEqual({ address: plainAddress, isSigner: true, isWritable: false });
    });

    it('resolves a pubkey-data meta', async () => {
        const client = await createTestClient();
        const instructionData = new Uint8Array([0xff, ...getAddressEncoder().encode(mint)]);
        // The pubkey is read from the instruction data at offset 1.
        const meta: ExtraAccountMeta = {
            config: { __kind: 'PubkeyData', pubkeyData: { __kind: 'InstructionData', index: 1 } },
            isSigner: false,
            isWritable: true,
        };

        const resolved = await resolveExtraAccountMeta(meta, [], instructionData, transferHookProgramId, client.rpc);

        expect(resolved).toEqual({ address: mint, isSigner: false, isWritable: true });
    });

    it('derives a PDA off the transfer hook program', async () => {
        const client = await createTestClient();
        const meta: ExtraAccountMeta = {
            config: { __kind: 'ProgramPda', seeds: [{ __kind: 'Literal', bytes: new Uint8Array([0xaa, 0xbb]) }] },
            isSigner: false,
            isWritable: true,
        };

        const [expected] = await getProgramDerivedAddress({
            programAddress: transferHookProgramId,
            seeds: [new Uint8Array([0xaa, 0xbb])],
        });
        const resolved = await resolveExtraAccountMeta(meta, [], new Uint8Array(), transferHookProgramId, client.rpc);

        expect(resolved).toEqual({ address: expected, isSigner: false, isWritable: true });
    });

    it('derives a PDA owned by a previously resolved account', async () => {
        const client = await createTestClient();
        // account index 0 -> previousMetas[0] (the mint) is the PDA program.
        const meta: ExtraAccountMeta = {
            config: {
                __kind: 'AccountPda',
                accountIndex: 0,
                seeds: [{ __kind: 'Literal', bytes: new Uint8Array([0xaa]) }],
            },
            isSigner: false,
            isWritable: false,
        };

        const [expected] = await getProgramDerivedAddress({
            programAddress: mint,
            seeds: [new Uint8Array([0xaa])],
        });
        const resolved = await resolveExtraAccountMeta(
            meta,
            [mint],
            new Uint8Array(),
            transferHookProgramId,
            client.rpc,
        );

        expect(resolved).toEqual({ address: expected, isSigner: false, isWritable: false });
    });

    it('throws when the account-index config references an out-of-bounds account', async () => {
        const client = await createTestClient();
        const meta: ExtraAccountMeta = {
            config: { __kind: 'AccountPda', accountIndex: 2, seeds: [] },
            isSigner: false,
            isWritable: false,
        };

        await expect(
            resolveExtraAccountMeta(meta, [], new Uint8Array(), transferHookProgramId, client.rpc),
        ).rejects.toThrow();
    });
});

describe('deEscalateAccountMeta', () => {
    it('returns the meta unchanged when its address has no prior occurrence', () => {
        const meta = { address: plainAddress, role: AccountRole.WRITABLE_SIGNER };

        expect(deEscalateAccountMeta(meta, [{ address: mint, role: AccountRole.READONLY }])).toEqual(meta);
    });

    it('strips signer and writable when a prior occurrence is read-only', () => {
        const meta = { address: plainAddress, role: AccountRole.WRITABLE_SIGNER };

        const deEscalated = deEscalateAccountMeta(meta, [{ address: plainAddress, role: AccountRole.READONLY }]);

        expect(deEscalated).toEqual({ address: plainAddress, role: AccountRole.READONLY });
    });

    it('keeps the highest privilege seen across multiple prior occurrences', () => {
        const meta = { address: plainAddress, role: AccountRole.WRITABLE_SIGNER };

        const deEscalated = deEscalateAccountMeta(meta, [
            { address: plainAddress, role: AccountRole.READONLY_SIGNER },
            { address: plainAddress, role: AccountRole.WRITABLE },
        ]);

        expect(deEscalated).toEqual(meta);
    });
});

function mintAccountData(transferHookProgramAddress?: Address): Uint8Array {
    const hookAuthority = address('BQWWFhzBdw2vKKBUX17NHeFbCoFQHfRARpdztPE2tDJ7');
    return new Uint8Array(
        getMintEncoder().encode({
            decimals: 6,
            extensions: transferHookProgramAddress
                ? some([{ __kind: 'TransferHook', authority: hookAuthority, programId: transferHookProgramAddress }])
                : none(),
            freezeAuthority: none(),
            isInitialized: true,
            mintAuthority: none(),
            supply: 0n,
        }),
    );
}

describe('resolveExtraAccountMetasForExecute', () => {
    it('returns no accounts when the mint has no validation account', async () => {
        const client = await createTestClient();

        const resolved = await resolveExtraAccountMetasForExecute({
            amount: 1n,
            destination: address('C1ockyE1TGaXK1gN3iF6Fz9tnhr2Q3vsdjPHXm44rQnU'),
            mint,
            owner: address('D5jyaVjrWuq7ostc8JYywr3QDPtM6y6TZKG1TgRhZYSp'),
            rpc: client.rpc,
            source: plainAddress,
            transferHookProgramAddress: transferHookProgramId,
        });

        expect(resolved).toEqual([]);
    });

    it('appends the resolved extras, hook program, and validation state', async () => {
        const client = await createTestClient();
        const source = plainAddress;
        const mintAddress = mint;
        const destination = address('C1ockyE1TGaXK1gN3iF6Fz9tnhr2Q3vsdjPHXm44rQnU');
        const owner = address('D5jyaVjrWuq7ostc8JYywr3QDPtM6y6TZKG1TgRhZYSp');
        const extraAccount = address('AKPu7hnbAfsjixnPvGReDbmAYUJErkw8H6cRc3ohh2xf');

        const [validateStatePubkey] = await findExtraAccountMetaListPda(
            { mint: mintAddress },
            { programAddress: transferHookProgramId },
        );
        setValidationAccount(client.svm, validateStatePubkey, [
            { config: { __kind: 'Literal', address: extraAccount }, isSigner: false, isWritable: true },
        ]);

        const resolved = await resolveExtraAccountMetasForExecute({
            amount: 1n,
            destination,
            mint: mintAddress,
            owner,
            rpc: client.rpc,
            source,
            transferHookProgramAddress: transferHookProgramId,
        });

        expect(resolved).toEqual([
            { address: extraAccount, role: AccountRole.WRITABLE },
            { address: transferHookProgramId, role: AccountRole.READONLY },
            { address: validateStatePubkey, role: AccountRole.READONLY },
        ]);
    });

    it('de-escalates an extra account duplicating the owner', async () => {
        const client = await createTestClient();
        const source = plainAddress;
        const mintAddress = mint;
        const destination = address('C1ockyE1TGaXK1gN3iF6Fz9tnhr2Q3vsdjPHXm44rQnU');
        const owner = address('D5jyaVjrWuq7ostc8JYywr3QDPtM6y6TZKG1TgRhZYSp');

        const [validateStatePubkey] = await findExtraAccountMetaListPda(
            { mint: mintAddress },
            { programAddress: transferHookProgramId },
        );
        // Configured as a writable signer, but it duplicates `owner`, which the base transfer only
        // grants read-only (unrelated to this helper's own signer/writable status).
        setValidationAccount(client.svm, validateStatePubkey, [
            { config: { __kind: 'Literal', address: owner }, isSigner: true, isWritable: true },
        ]);

        const resolved = await resolveExtraAccountMetasForExecute({
            amount: 1n,
            destination,
            mint: mintAddress,
            owner,
            rpc: client.rpc,
            source,
            transferHookProgramAddress: transferHookProgramId,
        });

        expect(resolved).toEqual([
            { address: owner, role: AccountRole.READONLY },
            { address: transferHookProgramId, role: AccountRole.READONLY },
            { address: validateStatePubkey, role: AccountRole.READONLY },
        ]);
    });

    it('resolves a validation account mixing literal, chained-PDA, and instruction-data-seeded extras', async () => {
        const client = await createTestClient();
        const source = plainAddress;
        const mintAddress = mint;
        const destination = address('C1ockyE1TGaXK1gN3iF6Fz9tnhr2Q3vsdjPHXm44rQnU');
        const owner = address('D5jyaVjrWuq7ostc8JYywr3QDPtM6y6TZKG1TgRhZYSp');
        const amount = 100n;

        // Three unrelated literal-pubkey extras, resolved into base account indices 5, 6, 7.
        const extraMeta1 = address('So11111111111111111111111111111111111111112');
        const extraMeta2 = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
        const extraMeta3 = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

        const [validateStatePubkey] = await findExtraAccountMetaListPda(
            { mint: mintAddress },
            { programAddress: transferHookProgramId },
        );

        const prefix = new Uint8Array([112, 114, 101, 102, 105, 120]); // "prefix"
        setValidationAccount(client.svm, validateStatePubkey, [
            { config: { __kind: 'Literal', address: extraMeta1 }, isSigner: false, isWritable: false },
            { config: { __kind: 'Literal', address: extraMeta2 }, isSigner: false, isWritable: false },
            { config: { __kind: 'Literal', address: extraMeta3 }, isSigner: false, isWritable: false },
            // PDA off the transfer hook program, seeded by account keys at index 0 (source) and 4
            // (the validation state account itself).
            {
                config: {
                    __kind: 'ProgramPda',
                    seeds: [
                        { __kind: 'AccountKey', index: 0 },
                        { __kind: 'AccountKey', index: 4 },
                    ],
                },
                isSigner: false,
                isWritable: false,
            },
            // PDA off the transfer hook program, seeded by account keys at index 5 and 6 -- the two
            // literal extras resolved just above, exercising the previously-resolved-account chaining
            // that a single-extra test can't reach.
            {
                config: {
                    __kind: 'ProgramPda',
                    seeds: [
                        { __kind: 'AccountKey', index: 5 },
                        { __kind: 'AccountKey', index: 6 },
                    ],
                },
                isSigner: false,
                isWritable: false,
            },
            // PDA off the transfer hook program, seeded by the literal "prefix" followed by
            // instruction data bytes 8..16 (the execute instruction's `amount`).
            {
                config: {
                    __kind: 'ProgramPda',
                    seeds: [
                        { __kind: 'Literal', bytes: prefix },
                        { __kind: 'InstructionData', index: 8, length: 8 },
                    ],
                },
                isSigner: false,
                isWritable: false,
            },
        ]);

        const amountBytes = getU64Encoder().encode(amount);
        const [pdaFromBaseAccounts] = await getProgramDerivedAddress({
            programAddress: transferHookProgramId,
            seeds: [getAddressEncoder().encode(source), getAddressEncoder().encode(validateStatePubkey)],
        });
        const [pdaFromChainedExtras] = await getProgramDerivedAddress({
            programAddress: transferHookProgramId,
            seeds: [getAddressEncoder().encode(extraMeta1), getAddressEncoder().encode(extraMeta2)],
        });
        const [pdaFromLiteralAndInstructionData] = await getProgramDerivedAddress({
            programAddress: transferHookProgramId,
            seeds: [prefix, amountBytes],
        });

        const resolved = await resolveExtraAccountMetasForExecute({
            amount,
            destination,
            mint: mintAddress,
            owner,
            rpc: client.rpc,
            source,
            transferHookProgramAddress: transferHookProgramId,
        });

        expect(resolved).toEqual([
            { address: extraMeta1, role: AccountRole.READONLY },
            { address: extraMeta2, role: AccountRole.READONLY },
            { address: extraMeta3, role: AccountRole.READONLY },
            { address: pdaFromBaseAccounts, role: AccountRole.READONLY },
            { address: pdaFromChainedExtras, role: AccountRole.READONLY },
            { address: pdaFromLiteralAndInstructionData, role: AccountRole.READONLY },
            { address: transferHookProgramId, role: AccountRole.READONLY },
            { address: validateStatePubkey, role: AccountRole.READONLY },
        ]);
    });
});

describe('getTransferCheckedWithTransferHookInstructionAsync', () => {
    it('appends resolved extras when the mint has a hook', async () => {
        const client = await createTestClient();
        const source = plainAddress;
        const destination = address('C1ockyE1TGaXK1gN3iF6Fz9tnhr2Q3vsdjPHXm44rQnU');
        const authority = address('D5jyaVjrWuq7ostc8JYywr3QDPtM6y6TZKG1TgRhZYSp');
        const literalExtra = address('AKPu7hnbAfsjixnPvGReDbmAYUJErkw8H6cRc3ohh2xf');
        const amount = 1000n;

        setAccountData(client.svm, mint, mintAccountData(transferHookProgramId));

        const [validateStatePubkey] = await findExtraAccountMetaListPda(
            { mint },
            { programAddress: transferHookProgramId },
        );
        setValidationAccount(client.svm, validateStatePubkey, [
            { config: { __kind: 'Literal', address: literalExtra }, isSigner: false, isWritable: true },
            // PDA off the transfer hook program, seeded by the account key at index 0 (source).
            {
                config: { __kind: 'ProgramPda', seeds: [{ __kind: 'AccountKey', index: 0 }] },
                isSigner: false,
                isWritable: false,
            },
        ]);

        const [pdaFromSource] = await getProgramDerivedAddress({
            programAddress: transferHookProgramId,
            seeds: [getAddressEncoder().encode(source)],
        });

        const instruction = await getTransferCheckedWithTransferHookInstructionAsync(client, {
            amount,
            authority,
            decimals: 6,
            destination,
            mint,
            source,
        });

        const referenceData = getTransferCheckedInstruction({
            amount,
            authority,
            decimals: 6,
            destination,
            mint,
            source,
        }).data;

        expect(instruction.programAddress).toBe(TOKEN_2022_PROGRAM_ADDRESS);
        expect(instruction.data).toStrictEqual(referenceData);
        expect(instruction.accounts).toStrictEqual([
            { address: source, role: AccountRole.WRITABLE },
            { address: mint, role: AccountRole.READONLY },
            { address: destination, role: AccountRole.WRITABLE },
            { address: authority, role: AccountRole.READONLY },
            { address: literalExtra, role: AccountRole.WRITABLE },
            { address: pdaFromSource, role: AccountRole.READONLY },
            { address: transferHookProgramId, role: AccountRole.READONLY },
            { address: validateStatePubkey, role: AccountRole.READONLY },
        ]);
    });

    it('returns a plain transfer when the mint has no hook', async () => {
        const client = await createTestClient();
        const source = plainAddress;
        const destination = address('C1ockyE1TGaXK1gN3iF6Fz9tnhr2Q3vsdjPHXm44rQnU');
        const authority = address('D5jyaVjrWuq7ostc8JYywr3QDPtM6y6TZKG1TgRhZYSp');

        setAccountData(client.svm, mint, mintAccountData());

        const instruction = await getTransferCheckedWithTransferHookInstructionAsync(client, {
            amount: 1000n,
            authority,
            decimals: 6,
            destination,
            mint,
            source,
        });

        expect(instruction.accounts).toStrictEqual([
            { address: source, role: AccountRole.WRITABLE },
            { address: mint, role: AccountRole.READONLY },
            { address: destination, role: AccountRole.WRITABLE },
            { address: authority, role: AccountRole.READONLY },
        ]);
    });
});
