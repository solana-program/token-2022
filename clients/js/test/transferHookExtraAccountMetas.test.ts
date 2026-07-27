import {
    address,
    AccountRole,
    createClient,
    getAddressEncoder,
    getProgramDerivedAddress,
    lamports,
    type Address,
    type ReadonlyUint8Array,
} from '@solana/kit';
import { litesvm } from '@solana/kit-plugin-litesvm';
import { generatedSigner } from '@solana/kit-plugin-signer';
import { expect, it } from 'vitest';

import {
    deEscalateAccountMeta,
    findExtraAccountMetaListPda,
    getExtraAccountMetas,
    resolveExtraAccountMeta,
    resolveExtraAccountMetasForExecute,
    unpackPubkeyData,
    unpackSeeds,
    type ExtraAccountMeta,
} from '../src';

const plainAddress = address('6c5q79ccBTWvZTEx3JkdHThtMa2eALba5bfvHGf8kA2c');
const transferHookProgramId = address('7N4HggYEJAtCLJdnHGCtFqfxcB5rhQCsQTze3ftYstVj');
const mint = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const systemProgramAddress = address('11111111111111111111111111111111');

// A LiteSVM-backed client provides a real `Rpc<GetAccountInfoApi>` for the account-data
// seed/pubkey-data variants, which need to fetch a previously resolved account's data.
async function createTestRpc() {
    const client = await createClient().use(generatedSigner()).use(litesvm());
    return { rpc: client.rpc, svm: client.svm };
}

function setAccountData(
    svm: Awaited<ReturnType<typeof createTestRpc>>['svm'],
    accountAddress: Address,
    data: Uint8Array,
) {
    svm.setAccount({
        address: accountAddress,
        data,
        executable: false,
        lamports: lamports(1_000_000n),
        programAddress: systemProgramAddress,
        space: BigInt(data.length),
    });
}

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

function extraAccountMeta(
    discriminator: number,
    addressConfig: Uint8Array,
    isSigner: boolean,
    isWritable: boolean,
): ExtraAccountMeta {
    return { addressConfig, discriminator, isSigner, isWritable };
}

function validateStateAccountData(extraAccounts: Uint8Array[]): Uint8Array {
    return new Uint8Array([
        ...new Array(8).fill(0), // u64 instructionDiscriminator (unused by getExtraAccountMetas)
        ...new Array(4).fill(0), // u32 length (unused by getExtraAccountMetas)
        extraAccounts.length,
        0,
        0,
        0, // u32 count
        ...extraAccounts.flatMap(entry => [...entry]),
    ]);
}

it('finds the same PDA as a manual derivation off the "extra-account-metas" seed', async () => {
    const [expected] = await getProgramDerivedAddress({
        programAddress: transferHookProgramId,
        seeds: ['extra-account-metas', getAddressEncoder().encode(mint)],
    });

    const [actual] = await findExtraAccountMetaListPda({ mint }, { programAddress: transferHookProgramId });

    expect(actual).toBe(expected);
});

it('parses extra account metas from validation account data, ignoring trailing bytes past count', () => {
    const addressConfig = new Uint8Array(32);
    addressConfig.set(getAddressEncoder().encode(plainAddress), 0);

    const plainExtraAccount = extraAccountMetaBytes(0, addressConfig, false, false);
    const pdaExtraAccount = extraAccountMetaBytes(1, addressConfig, true, false);

    const data = new Uint8Array([
        ...new Array(8).fill(0), // u64 instructionDiscriminator
        ...new Array(4).fill(0), // u32 length
        1,
        0,
        0,
        0, // u32 count -- only the first entry is "in bounds"
        ...plainExtraAccount,
        ...pdaExtraAccount, // trailing bytes past `count`, should be dropped
    ]);

    const parsed = getExtraAccountMetas(data);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].discriminator).toBe(0);
    expect(parsed[0].addressConfig).toEqual(addressConfig);
    expect(parsed[0].isSigner).toBe(false);
    expect(parsed[0].isWritable).toBe(false);
});

it('unpackSeeds resolves a literal seed followed by the terminator', async () => {
    const { rpc } = await createTestRpc();
    const seeds = new Uint8Array([1, 3, 0xaa, 0xbb, 0xcc, 0]);

    const resolved = await unpackSeeds(seeds, [], new Uint8Array(), rpc);

    expect(resolved).toEqual([new Uint8Array([0xaa, 0xbb, 0xcc])]);
});

it('unpackSeeds resolves an instruction-arg seed', async () => {
    const { rpc } = await createTestRpc();
    const instructionData = new Uint8Array([10, 20, 30, 40, 50]);
    const seeds = new Uint8Array([2, 1, 3, 0]); // offset 1, length 3 -> [20, 30, 40]

    const resolved = await unpackSeeds(seeds, [], instructionData, rpc);

    expect(resolved).toEqual([new Uint8Array([20, 30, 40])]);
});

it('unpackSeeds resolves an account-key seed to a previously resolved account address', async () => {
    const { rpc } = await createTestRpc();
    const seeds = new Uint8Array([3, 1, 0]); // account index 1

    const resolved = await unpackSeeds(seeds, [plainAddress, mint], new Uint8Array(), rpc);

    expect(resolved).toEqual([getAddressEncoder().encode(mint)]);
});

it('unpackSeeds resolves an account-data seed by fetching the account over rpc', async () => {
    const { rpc, svm } = await createTestRpc();
    const accountData = new Uint8Array([0, 0, 0xde, 0xad, 0xbe, 0xef, 0, 0]);
    setAccountData(svm, plainAddress, accountData);
    const seeds = new Uint8Array([4, 0, 2, 4, 0]); // account index 0, data offset 2, length 4

    const resolved = await unpackSeeds(seeds, [plainAddress], new Uint8Array(), rpc);

    expect(resolved).toEqual([new Uint8Array([0xde, 0xad, 0xbe, 0xef])]);
});

it("unpackSeeds resolves multiple seeds in sequence, advancing by each seed's packed length", async () => {
    const { rpc } = await createTestRpc();
    const seeds = new Uint8Array([
        1,
        2,
        0x01,
        0x02, // literal [0x01, 0x02]
        3,
        0, // account key at index 0
        0, // terminator
    ]);

    const resolved = await unpackSeeds(seeds, [plainAddress], new Uint8Array(), rpc);

    expect(resolved).toEqual([new Uint8Array([0x01, 0x02]), getAddressEncoder().encode(plainAddress)]);
});

it('unpackSeeds returns an empty list when the first seed is the terminator', async () => {
    const { rpc } = await createTestRpc();

    const resolved = await unpackSeeds(new Uint8Array([0]), [], new Uint8Array(), rpc);

    expect(resolved).toEqual([]);
});

it('unpackSeeds throws on an unknown seed discriminator', async () => {
    const { rpc } = await createTestRpc();

    await expect(unpackSeeds(new Uint8Array([9]), [], new Uint8Array(), rpc)).rejects.toThrow();
});

it('unpackSeeds throws when an account-key seed references an out-of-bounds account index', async () => {
    const { rpc } = await createTestRpc();

    await expect(unpackSeeds(new Uint8Array([3, 0]), [], new Uint8Array(), rpc)).rejects.toThrow();
});

it('unpackSeeds throws when an account-data seed references an account that does not exist', async () => {
    const { rpc } = await createTestRpc();
    const seeds = new Uint8Array([4, 0, 0, 1, 0]);

    await expect(unpackSeeds(seeds, [plainAddress], new Uint8Array(), rpc)).rejects.toThrow();
});

it('unpackPubkeyData resolves an address from instruction data', async () => {
    const { rpc } = await createTestRpc();
    const addressBytes = getAddressEncoder().encode(mint);
    const instructionData = new Uint8Array([0xff, ...addressBytes]);
    const keyDataConfig = new Uint8Array([1, 1]); // instruction-data source, offset 1

    const resolved = await unpackPubkeyData(keyDataConfig, [], instructionData, rpc);

    expect(resolved).toBe(mint);
});

it("unpackPubkeyData resolves an address from a previously resolved account's data", async () => {
    const { rpc, svm } = await createTestRpc();
    const addressBytes = getAddressEncoder().encode(mint);
    const accountData = new Uint8Array([0xff, ...addressBytes]);
    setAccountData(svm, plainAddress, accountData);
    const keyDataConfig = new Uint8Array([2, 0, 1]); // account-data source, account index 0, offset 1

    const resolved = await unpackPubkeyData(keyDataConfig, [plainAddress], new Uint8Array(), rpc);

    expect(resolved).toBe(mint);
});

it('unpackPubkeyData throws on an unknown pubkey-data discriminator', async () => {
    const { rpc } = await createTestRpc();

    await expect(unpackPubkeyData(new Uint8Array([9]), [], new Uint8Array(), rpc)).rejects.toThrow();
});

it('unpackPubkeyData throws when instruction data is too small for a pubkey at the declared offset', async () => {
    const { rpc } = await createTestRpc();

    await expect(unpackPubkeyData(new Uint8Array([1, 0]), [], new Uint8Array(4), rpc)).rejects.toThrow();
});

it('unpackPubkeyData throws when the referenced account does not exist', async () => {
    const { rpc } = await createTestRpc();

    await expect(unpackPubkeyData(new Uint8Array([2, 0, 0]), [plainAddress], new Uint8Array(), rpc)).rejects.toThrow();
});

it('resolveExtraAccountMeta resolves a literal-pubkey (discriminator 0) meta', async () => {
    const { rpc } = await createTestRpc();
    const meta = extraAccountMeta(0, addressConfigOf(getAddressEncoder().encode(plainAddress)), true, false);

    const resolved = await resolveExtraAccountMeta(meta, [], new Uint8Array(), transferHookProgramId, rpc);

    expect(resolved).toEqual({ address: plainAddress, isSigner: true, isWritable: false });
});

it('resolveExtraAccountMeta resolves a pubkey-data (discriminator 2) meta', async () => {
    const { rpc } = await createTestRpc();
    const addressBytes = getAddressEncoder().encode(mint);
    const instructionData = new Uint8Array([0xff, ...addressBytes]);
    // pubkey-data source: instruction-data, offset 1
    const meta = extraAccountMeta(2, addressConfigOf(new Uint8Array([1, 1])), false, true);

    const resolved = await resolveExtraAccountMeta(meta, [], instructionData, transferHookProgramId, rpc);

    expect(resolved).toEqual({ address: mint, isSigner: false, isWritable: true });
});

it('resolveExtraAccountMeta derives a PDA off the transfer hook program (discriminator 1)', async () => {
    const { rpc } = await createTestRpc();
    // seeds: one literal seed [0xaa, 0xbb], then terminator
    const meta = extraAccountMeta(1, addressConfigOf(new Uint8Array([1, 2, 0xaa, 0xbb, 0])), false, true);

    const [expected] = await getProgramDerivedAddress({
        programAddress: transferHookProgramId,
        seeds: [new Uint8Array([0xaa, 0xbb])],
    });
    const resolved = await resolveExtraAccountMeta(meta, [], new Uint8Array(), transferHookProgramId, rpc);

    expect(resolved).toEqual({ address: expected, isSigner: false, isWritable: true });
});

it('resolveExtraAccountMeta derives a PDA owned by a previously resolved account', async () => {
    const { rpc } = await createTestRpc();
    // account index 0 -> previousMetas[0] is the PDA program; seeds: literal [0xaa], terminator
    const meta = extraAccountMeta(1 << 7, addressConfigOf(new Uint8Array([1, 1, 0xaa, 0])), false, false);

    const [expected] = await getProgramDerivedAddress({
        programAddress: mint,
        seeds: [new Uint8Array([0xaa])],
    });
    const resolved = await resolveExtraAccountMeta(meta, [mint], new Uint8Array(), transferHookProgramId, rpc);

    expect(resolved).toEqual({ address: expected, isSigner: false, isWritable: false });
});

it('resolveExtraAccountMeta throws when the account-index discriminator is out of bounds', async () => {
    const { rpc } = await createTestRpc();
    const meta = extraAccountMeta((1 << 7) + 2, addressConfigOf(new Uint8Array([0])), false, false);

    await expect(resolveExtraAccountMeta(meta, [], new Uint8Array(), transferHookProgramId, rpc)).rejects.toThrow();
});

it('deEscalateAccountMeta returns the meta unchanged when its address has no prior occurrence', () => {
    const meta = { address: plainAddress, role: AccountRole.WRITABLE_SIGNER };

    expect(deEscalateAccountMeta(meta, [{ address: mint, role: AccountRole.READONLY }])).toEqual(meta);
});

it('deEscalateAccountMeta strips signer and writable when a prior occurrence is read-only', () => {
    const meta = { address: plainAddress, role: AccountRole.WRITABLE_SIGNER };

    const deEscalated = deEscalateAccountMeta(meta, [{ address: plainAddress, role: AccountRole.READONLY }]);

    expect(deEscalated).toEqual({ address: plainAddress, role: AccountRole.READONLY });
});

it('deEscalateAccountMeta keeps the highest privilege seen across multiple prior occurrences', () => {
    const meta = { address: plainAddress, role: AccountRole.WRITABLE_SIGNER };

    const deEscalated = deEscalateAccountMeta(meta, [
        { address: plainAddress, role: AccountRole.READONLY_SIGNER },
        { address: plainAddress, role: AccountRole.WRITABLE },
    ]);

    expect(deEscalated).toEqual(meta);
});

it('resolveExtraAccountMetasForExecute returns no accounts when the mint has no validation account', async () => {
    const { rpc } = await createTestRpc();

    const resolved = await resolveExtraAccountMetasForExecute({
        amount: 1n,
        destination: address('C1ockyE1TGaXK1gN3iF6Fz9tnhr2Q3vsdjPHXm44rQnU'),
        mint,
        owner: address('D5jyaVjrWuq7ostc8JYywr3QDPtM6y6TZKG1TgRhZYSp'),
        rpc,
        source: plainAddress,
        transferHookProgramAddress: transferHookProgramId,
    });

    expect(resolved).toEqual([]);
});

it('resolveExtraAccountMetasForExecute appends the resolved extras, hook program, and validation state', async () => {
    const { rpc, svm } = await createTestRpc();
    const source = plainAddress;
    const mintAddress = mint;
    const destination = address('C1ockyE1TGaXK1gN3iF6Fz9tnhr2Q3vsdjPHXm44rQnU');
    const owner = address('D5jyaVjrWuq7ostc8JYywr3QDPtM6y6TZKG1TgRhZYSp');
    const extraAccount = address('AKPu7hnbAfsjixnPvGReDbmAYUJErkw8H6cRc3ohh2xf');

    const [validateStatePubkey] = await findExtraAccountMetaListPda(
        { mint: mintAddress },
        { programAddress: transferHookProgramId },
    );
    setAccountData(
        svm,
        validateStatePubkey,
        validateStateAccountData([
            extraAccountMetaBytes(0, addressConfigOf(getAddressEncoder().encode(extraAccount)), false, true),
        ]),
    );

    const resolved = await resolveExtraAccountMetasForExecute({
        amount: 1n,
        destination,
        mint: mintAddress,
        owner,
        rpc,
        source,
        transferHookProgramAddress: transferHookProgramId,
    });

    expect(resolved).toEqual([
        { address: extraAccount, role: AccountRole.WRITABLE },
        { address: transferHookProgramId, role: AccountRole.READONLY },
        { address: validateStatePubkey, role: AccountRole.READONLY },
    ]);
});

it('resolveExtraAccountMetasForExecute de-escalates an extra account duplicating the owner', async () => {
    const { rpc, svm } = await createTestRpc();
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
    setAccountData(
        svm,
        validateStatePubkey,
        validateStateAccountData([
            extraAccountMetaBytes(0, addressConfigOf(getAddressEncoder().encode(owner)), true, true),
        ]),
    );

    const resolved = await resolveExtraAccountMetasForExecute({
        amount: 1n,
        destination,
        mint: mintAddress,
        owner,
        rpc,
        source,
        transferHookProgramAddress: transferHookProgramId,
    });

    expect(resolved).toEqual([
        { address: owner, role: AccountRole.READONLY },
        { address: transferHookProgramId, role: AccountRole.READONLY },
        { address: validateStatePubkey, role: AccountRole.READONLY },
    ]);
});
