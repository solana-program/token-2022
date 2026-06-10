import {
    AccountRole,
    type AccountMeta,
    type Address,
    address,
    type Base64EncodedBytes,
    fixEncoderSize,
    getAddressEncoder,
    type GetAccountInfoApi,
    getBase64Decoder,
    getBytesEncoder,
    getProgramDerivedAddress,
    getU64Decoder,
    getU64Encoder,
    isSolanaError,
    type Lamports,
    none,
    SOLANA_ERROR__ACCOUNTS__ACCOUNT_NOT_FOUND,
    type ReadonlyUint8Array,
    type Rpc,
    some,
} from '@solana/kit';
import test from 'ava';
import {
    addExtraAccountMetasForExecute,
    EXECUTE_DISCRIMINATOR,
    extension,
    type ExtraAccountMeta,
    fetchExtraAccountMetaList,
    findExtraAccountMetasPda,
    getExecuteInstruction,
    getExtraAccountMetaAccountDataCodec,
    getMintEncoder,
    getTransferCheckedWithFeeAndTransferHookInstructionAsync,
    getTransferCheckedWithTransferHookInstructionAsync,
    resolveExtraAccountMeta,
    TOKEN_2022_PROGRAM_ADDRESS,
} from '../../../src';

const TEST_PROGRAM_ID = address('7N4HggYEJAtCLJdnHGCtFqfxcB5rhQCsQTze3ftYstVj');
const PLAIN_ACCOUNT = address('6c5q79ccBTWvZTEx3JkdHThtMa2eALba5bfvHGf8kA2c');
const TRANSFER_HOOK_PROGRAM_ID = address('FrgrnfMR3cpnHwbDeZZHnf2rDhmwBDQAhuviVHHzMrAB');
const ARBITRARY_PROGRAM_ID = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SOURCE = address('Hr87FrCCpgZ2QSDarUDhXZbhe1m9LBpVAEhCMjpiZ1Nu');
const MINT = address('5gSwsLGzyCwgwPJSnxjsQCaFeE19ZFaibHMLky9TDFim');
const DESTINATION = address('FtL1iJDFcoBYW3qZRmp45RFMtacKgEqJqkqEHCQ4UTog');
const AUTHORITY = address('4bxbXTminNNNGsGNeZ8VgvyVnTNVCBjPFHM9DJ4QpvBe');

const addressEncoder = getAddressEncoder();

function getMockRpc(accounts: Record<Address, ReadonlyUint8Array>): Rpc<GetAccountInfoApi> {
    const getAccountInfo = (address: Address) => ({
        send: () => {
            const data = accounts[address];
            return Promise.resolve({
                context: { slot: 0n },
                value: data
                    ? {
                          data: [getBase64Decoder().decode(data), 'base64'] as [Base64EncodedBytes, 'base64'],
                          executable: false,
                          lamports: 1_000_000n as Lamports,
                          owner: TOKEN_2022_PROGRAM_ADDRESS,
                          rentEpoch: 0n,
                          space: BigInt(data.length),
                      }
                    : null,
            });
        },
    });
    return { getAccountInfo } as unknown as Rpc<GetAccountInfoApi>;
}

const addressConfigEncoder = fixEncoderSize(getBytesEncoder(), 32);
const padTo32 = (bytes: number[]) => addressConfigEncoder.encode(new Uint8Array(bytes));

function extraAccountMeta(
    discriminator: number,
    addressConfig: ReadonlyUint8Array,
    isSigner = false,
    isWritable = false,
): ExtraAccountMeta {
    return { addressConfig, discriminator, isSigner, isWritable };
}

const fixedAddress = (account: Address, isSigner = false, isWritable = false) =>
    extraAccountMeta(0, new Uint8Array(addressEncoder.encode(account)), isSigner, isWritable);
const pda = (seeds: number[], isSigner = false, isWritable = false) =>
    extraAccountMeta(1, padTo32(seeds), isSigner, isWritable);
const externalPda = (programKeyIndex: number, seeds: number[], isSigner = false, isWritable = false) =>
    extraAccountMeta((1 << 7) + programKeyIndex, padTo32(seeds), isSigner, isWritable);

function encodeValidationData(extraAccountMetas: ExtraAccountMeta[]): ReadonlyUint8Array {
    return getExtraAccountMetaAccountDataCodec().encode({
        extraAccountMetas,
        instructionDiscriminator: getU64Decoder().decode(EXECUTE_DISCRIMINATOR),
        length: 4 + 35 * extraAccountMetas.length,
    });
}

function createMintData(transferHookProgramId: Address): ReadonlyUint8Array {
    return getMintEncoder().encode({
        decimals: 0,
        extensions: some([
            extension('TransferHook', {
                authority: TEST_PROGRAM_ID,
                programId: transferHookProgramId,
            }),
        ]),
        freezeAuthority: none(),
        isInitialized: true,
        mintAuthority: none(),
        supply: 10_000n,
    });
}

test('it fetches and decodes a validation account', async t => {
    // Given a validation account encoding three kinds of extra account metas.
    const metas = [fixedAddress(PLAIN_ACCOUNT), pda([3, 0], true, false), externalPda(0, [3, 0], false, true)];
    const rpc = getMockRpc({ [PLAIN_ACCOUNT]: encodeValidationData(metas) });

    // When we fetch and decode it.
    const validationAccount = await fetchExtraAccountMetaList(rpc, PLAIN_ACCOUNT);

    // Then we expect the same extra account metas back.
    t.deepEqual(validationAccount.data.extraAccountMetas, metas);
});

test('it resolves each kind of extra account meta', async t => {
    // Given an RPC returning fixed account data, some instruction data and a previously resolved meta.
    const accountData = new Uint8Array([0, 0, 2, 2, 2, 2, ...addressEncoder.encode(PLAIN_ACCOUNT)]);
    const rpc = getMockRpc({ [PLAIN_ACCOUNT]: accountData });

    const instructionData = new Uint8Array(64);
    instructionData.set(Array.from(Array(32).keys()), 0);
    instructionData.set(addressEncoder.encode(PLAIN_ACCOUNT), 32);

    const previousMetas: AccountMeta[] = [{ address: PLAIN_ACCOUNT, role: AccountRole.READONLY }];

    const seedsConfig = [
        1,
        4,
        ...Buffer.from('seed'), // Literal seed "seed".
        2,
        4,
        4, // Instruction data 4..8.
        3,
        0, // Account key at index 0.
        4,
        0,
        2,
        4, // Account data of account 0, offset 2, length 4.
    ];
    const expectedSeeds = [
        new Uint8Array(Buffer.from('seed')),
        instructionData.subarray(4, 8),
        addressEncoder.encode(PLAIN_ACCOUNT),
        accountData.subarray(2, 6),
    ];

    // When we resolve a fixed-address meta.
    const resolvedPlain = await resolveExtraAccountMeta(
        rpc,
        fixedAddress(PLAIN_ACCOUNT),
        [],
        instructionData,
        TEST_PROGRAM_ID,
    );

    // Then we expect its literal address.
    t.deepEqual(resolvedPlain, { address: PLAIN_ACCOUNT, role: AccountRole.READONLY });

    // When we resolve a PDA meta.
    const [expectedPda] = await getProgramDerivedAddress({ programAddress: TEST_PROGRAM_ID, seeds: expectedSeeds });
    const resolvedPda = await resolveExtraAccountMeta(
        rpc,
        pda(seedsConfig, true, false),
        previousMetas,
        instructionData,
        TEST_PROGRAM_ID,
    );

    // Then we expect the address derived from the hook program.
    t.deepEqual(resolvedPda, { address: expectedPda, role: AccountRole.READONLY_SIGNER });

    // When we resolve an external PDA meta.
    const [expectedExternalPda] = await getProgramDerivedAddress({
        programAddress: PLAIN_ACCOUNT,
        seeds: expectedSeeds,
    });
    const resolvedExternalPda = await resolveExtraAccountMeta(
        rpc,
        externalPda(0, seedsConfig, false, true),
        previousMetas,
        instructionData,
        TEST_PROGRAM_ID,
    );

    // Then we expect the address derived from the referenced program.
    t.deepEqual(resolvedExternalPda, { address: expectedExternalPda, role: AccountRole.WRITABLE });

    // When we resolve pubkey-data metas.
    const resolvedKeyDataFromInstruction = await resolveExtraAccountMeta(
        rpc,
        extraAccountMeta(2, padTo32([1, 32])),
        [],
        instructionData,
        TEST_PROGRAM_ID,
    );
    const resolvedKeyDataFromAccount = await resolveExtraAccountMeta(
        rpc,
        extraAccountMeta(2, padTo32([2, 0, 6])),
        previousMetas,
        instructionData,
        TEST_PROGRAM_ID,
    );

    // Then we expect the addresses read from the instruction data and the
    // referenced account's data.
    t.deepEqual(resolvedKeyDataFromInstruction, { address: PLAIN_ACCOUNT, role: AccountRole.READONLY });
    t.deepEqual(resolvedKeyDataFromAccount, { address: PLAIN_ACCOUNT, role: AccountRole.READONLY });
});

test('it adds extra account metas to a transfer instruction', async t => {
    // Given a mint with a transfer hook and a validation account listing
    // a fixed extra account and two seed-derived PDAs.
    const amount = 100n;
    const validationAddress = (
        await findExtraAccountMetasPda({ mint: MINT }, { programAddress: TRANSFER_HOOK_PROGRAM_ID })
    )[0];
    const fixedExtra = address('GLQGTjqsTaxjqkqKra2J9C2oTLAW8KPS3SBVLpEsbBED');
    const validationData = encodeValidationData([
        fixedAddress(fixedExtra),
        pda([3, 0, 3, 4]), // Seeds: account key 0 (source), account key 4 (validation account).
        pda([1, 6, ...Buffer.from('prefix'), 2, 8, 8]), // Seeds: literal "prefix", instruction data 8..16.
        fixedAddress(ARBITRARY_PROGRAM_ID),
        // PDA off the program at index 8, seeded by a literal, instruction
        // data 8..16 and the previously resolved meta at index 6.
        externalPda(8, [1, 6, ...Buffer.from('prefix'), 2, 8, 8, 3, 6]),
    ]);

    const rpc = getMockRpc({
        [MINT]: createMintData(TRANSFER_HOOK_PROGRAM_ID),
        [validationAddress]: validationData,
    });

    const [expectedPda1] = await getProgramDerivedAddress({
        programAddress: TRANSFER_HOOK_PROGRAM_ID,
        seeds: [addressEncoder.encode(SOURCE), addressEncoder.encode(validationAddress)],
    });
    const [expectedPda2] = await getProgramDerivedAddress({
        programAddress: TRANSFER_HOOK_PROGRAM_ID,
        seeds: ['prefix', getU64Encoder().encode(amount)],
    });
    const [expectedChainedPda] = await getProgramDerivedAddress({
        programAddress: ARBITRARY_PROGRAM_ID,
        seeds: ['prefix', getU64Encoder().encode(amount), addressEncoder.encode(expectedPda1)],
    });

    // When we build a transfer checked instruction with the transfer hook helper.
    const instruction = await getTransferCheckedWithTransferHookInstructionAsync(rpc, {
        amount,
        authority: AUTHORITY,
        decimals: 0,
        destination: DESTINATION,
        mint: MINT,
        source: SOURCE,
    });

    // Then we expect the resolved extra accounts, the hook program and the
    // validation account to be appended to the instruction.
    t.deepEqual(instruction.accounts, [
        { address: SOURCE, role: AccountRole.WRITABLE },
        { address: MINT, role: AccountRole.READONLY },
        { address: DESTINATION, role: AccountRole.WRITABLE },
        { address: AUTHORITY, role: AccountRole.READONLY },
        { address: fixedExtra, role: AccountRole.READONLY },
        { address: expectedPda1, role: AccountRole.READONLY },
        { address: expectedPda2, role: AccountRole.READONLY },
        { address: ARBITRARY_PROGRAM_ID, role: AccountRole.READONLY },
        { address: expectedChainedPda, role: AccountRole.READONLY },
        { address: TRANSFER_HOOK_PROGRAM_ID, role: AccountRole.READONLY },
        { address: validationAddress, role: AccountRole.READONLY },
    ]);
});

test('it adds extra account metas to a transfer with fee instruction', async t => {
    // Given a mint with a transfer hook and a validation account listing a fixed extra account.
    const validationAddress = (
        await findExtraAccountMetasPda({ mint: MINT }, { programAddress: TRANSFER_HOOK_PROGRAM_ID })
    )[0];
    const fixedExtra = address('GLQGTjqsTaxjqkqKra2J9C2oTLAW8KPS3SBVLpEsbBED');
    const rpc = getMockRpc({
        [MINT]: createMintData(TRANSFER_HOOK_PROGRAM_ID),
        [validationAddress]: encodeValidationData([fixedAddress(fixedExtra)]),
    });

    // When we build a transfer checked with fee instruction with the transfer hook helper.
    const instruction = await getTransferCheckedWithFeeAndTransferHookInstructionAsync(rpc, {
        amount: 100n,
        authority: AUTHORITY,
        decimals: 0,
        destination: DESTINATION,
        fee: 1n,
        mint: MINT,
        source: SOURCE,
    });

    // Then we expect the extra account, the hook program and the validation
    // account to be appended to the instruction.
    t.deepEqual(
        (instruction.accounts ?? []).slice(4).map(meta => meta.address),
        [fixedExtra, TRANSFER_HOOK_PROGRAM_ID, validationAddress],
    );
});

test('it fails to resolve an extra account meta with an invalid discriminator', async t => {
    // Given an extra account meta using the reserved discriminator 3.
    const rpc = getMockRpc({});

    // When we try to resolve it.
    const promise = resolveExtraAccountMeta(
        rpc,
        extraAccountMeta(3, padTo32([])),
        [],
        new Uint8Array(),
        TEST_PROGRAM_ID,
    );

    // Then we expect an error to be thrown.
    await t.throwsAsync(promise, { message: 'Invalid transfer hook extra account discriminator 3.' });
});

test('it fails to resolve a PDA meta whose seed config is truncated', async t => {
    // Given a PDA meta whose instruction data seed starts on the last config byte.
    const rpc = getMockRpc({});
    const truncatedConfig = [1, 28, ...Array<number>(28).fill(7), 2];

    // When we try to resolve it.
    const promise = resolveExtraAccountMeta(rpc, pda(truncatedConfig), [], new Uint8Array(16), TEST_PROGRAM_ID);

    // Then we expect an error to be thrown.
    await t.throwsAsync(promise, { message: 'Invalid transfer hook instruction data seed.' });
});

test('it fails when a required account is missing from the instruction', async t => {
    // Given an instruction missing the source account.
    const rpc = getMockRpc({});
    const instructionMissingSource = {
        accounts: [
            { address: MINT, role: AccountRole.READONLY },
            { address: DESTINATION, role: AccountRole.WRITABLE },
            { address: AUTHORITY, role: AccountRole.READONLY_SIGNER },
        ],
        data: new Uint8Array(),
        programAddress: TOKEN_2022_PROGRAM_ADDRESS,
    };

    // When we try to add the extra account metas to the instruction.
    const promise = addExtraAccountMetasForExecute(rpc, instructionMissingSource, TRANSFER_HOOK_PROGRAM_ID, {
        amount: 100n,
        destination: DESTINATION,
        mint: MINT,
        owner: AUTHORITY,
        source: SOURCE,
    });

    // Then we expect an error to be thrown.
    await t.throwsAsync(promise, { message: 'Missing required account in instruction.' });
});

test('it fails when the validation account does not exist', async t => {
    // Given a mint with a transfer hook but no initialized validation account.
    const rpc = getMockRpc({ [MINT]: createMintData(TRANSFER_HOOK_PROGRAM_ID) });

    // When we try to build a transfer checked instruction with the transfer hook helper.
    const promise = getTransferCheckedWithTransferHookInstructionAsync(rpc, {
        amount: 100n,
        authority: AUTHORITY,
        decimals: 0,
        destination: DESTINATION,
        mint: MINT,
        source: SOURCE,
    });

    // Then we expect an account-not-found error to be thrown.
    const error = await t.throwsAsync(promise);
    t.true(isSolanaError(error, SOLANA_ERROR__ACCOUNTS__ACCOUNT_NOT_FOUND));
});

test('it returns the instruction unchanged when the mint has no transfer hook', async t => {
    // Given a mint without a transfer hook extension.
    const mintData = getMintEncoder().encode({
        decimals: 0,
        extensions: none(),
        freezeAuthority: none(),
        isInitialized: true,
        mintAuthority: none(),
        supply: 10_000n,
    });
    const rpc = getMockRpc({ [MINT]: mintData });

    // When we build a transfer checked instruction with the transfer hook helper.
    const instruction = await getTransferCheckedWithTransferHookInstructionAsync(rpc, {
        amount: 100n,
        authority: AUTHORITY,
        decimals: 0,
        destination: DESTINATION,
        mint: MINT,
        source: SOURCE,
    });

    // Then we expect only the four base accounts.
    t.is(instruction.accounts?.length, 4);
});

test('it builds an execute instruction', async t => {
    // Given the base accounts of a transfer with a hooked mint.
    const validationAccount = (
        await findExtraAccountMetasPda({ mint: MINT }, { programAddress: TRANSFER_HOOK_PROGRAM_ID })
    )[0];

    // When we build the execute instruction.
    const instruction = getExecuteInstruction(
        {
            amount: 100n,
            destination: DESTINATION,
            mint: MINT,
            owner: AUTHORITY,
            source: SOURCE,
            validationAccount,
        },
        { programAddress: TRANSFER_HOOK_PROGRAM_ID },
    );

    // Then we expect it to target the hook program with the discriminator,
    // the amount and the base accounts.
    t.deepEqual(instruction.data, new Uint8Array([...EXECUTE_DISCRIMINATOR, ...getU64Encoder().encode(100n)]));
    t.is(instruction.programAddress, TRANSFER_HOOK_PROGRAM_ID);
    t.deepEqual(
        instruction.accounts?.map(meta => meta.address),
        [SOURCE, MINT, DESTINATION, AUTHORITY, validationAccount],
    );
    t.true(instruction.accounts?.every(meta => meta.role === AccountRole.READONLY));
});
