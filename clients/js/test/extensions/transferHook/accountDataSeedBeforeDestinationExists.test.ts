import path from 'node:path';

import {
    Address,
    address,
    assertAccountExists,
    fetchEncodedAccount,
    generateKeyPairSigner,
    getAddressEncoder,
    getProgramDerivedAddress,
    lamports,
    some,
} from '@solana/kit';
import { describe, expect, it } from 'vitest';

import {
    AccountState,
    ExtensionArgs,
    TOKEN_2022_PROGRAM_ADDRESS,
    TOKEN_PROGRAM_ADDRESS,
    Token,
    extension,
    fetchToken,
    findAssociatedTokenPda,
    findExtraAccountMetaListPda,
    getCreateAssociatedTokenIdempotentInstructionAsync,
    getDefaultInitializeExtraAccountMetaListInstructionAsync,
    getNewAssociatedTokenAccountDataAsync,
} from '../../../src';
import { createTestClient, createTokenWithAmount } from '../../_setup';

type TestClient = Awaited<ReturnType<typeof createTestClient>>;

const TRANSFER_HOOK_PROGRAM_ADDRESS = address('TokenHookExampLe8smaVNrxTBezWTRbEwxwb1Zykrb');
const NATIVE_MINT_ADDRESS = address('9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP');
const TRANSFER_HOOK_BINARY_PATH = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'rust-legacy',
    'tests',
    'fixtures',
    'spl_transfer_hook_example_no_default_features.so',
);

// `Execute`'s account list is source, mint, destination, owner, validation account. Index 2 is the
// destination token account; byte 32 of a token account is the start of its 32-byte `owner`.
const DESTINATION_ACCOUNT_INDEX = 2;
const TOKEN_OWNER_OFFSET = 32;
const TOKEN_OWNER_LENGTH = 32;

// The one extra account the hook requires: a PDA of the hook program seeded by the destination
// token account's `owner` field.
const DESTINATION_OWNER_SEEDED_PDA = {
    config: {
        __kind: 'ProgramPda' as const,
        seeds: [
            {
                __kind: 'AccountData' as const,
                accountIndex: DESTINATION_ACCOUNT_INDEX,
                dataIndex: TOKEN_OWNER_OFFSET,
                length: TOKEN_OWNER_LENGTH,
            },
        ],
    },
    isSigner: false,
    isWritable: false,
};

// Builds a hook mint whose validation account declares `DESTINATION_OWNER_SEEDED_PDA`, plus a
// funded source account. The destination ATA is deliberately left uncreated.
async function setupHookMintWithAccountDataSeed() {
    const client = await createTestClient();
    client.svm.addProgramFromFile(TRANSFER_HOOK_PROGRAM_ADDRESS, TRANSFER_HOOK_BINARY_PATH);

    const [mintAuthority, sourceOwner, destinationOwner, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const decimals = 2;
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            decimals,
            mintAuthority,
            extensions: [
                extension('TransferHook', {
                    authority: mintAuthority.address,
                    programId: TRANSFER_HOOK_PROGRAM_ADDRESS,
                }),
            ],
        })
        .sendTransaction();

    const [validateStatePubkey] = await findExtraAccountMetaListPda(
        { mint: mint.address },
        { programAddress: TRANSFER_HOOK_PROGRAM_ADDRESS },
    );
    await client.airdrop(validateStatePubkey, lamports(1_000_000_000n));
    await client.sendTransaction(
        await getDefaultInitializeExtraAccountMetaListInstructionAsync({
            mint: mint.address,
            authority: mintAuthority,
            extraAccountMetas: [DESTINATION_OWNER_SEEDED_PDA],
            transferHookProgram: TRANSFER_HOOK_PROGRAM_ADDRESS,
        }),
    );

    const source = await createTokenWithAmount({
        client,
        payer: client.payer,
        mint: mint.address,
        owner: sourceOwner,
        mintAuthority,
        amount: 100n,
        extensions: [extension('TransferHookAccount', { transferring: false })],
    });

    // The destination the transfer targets: an ATA that does not exist yet.
    const [destination] = await findAssociatedTokenPda({
        mint: mint.address,
        owner: destinationOwner.address,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });

    return { client, decimals, destination, destinationOwner, mint, source, sourceOwner, validateStatePubkey };
}

// Creates the ATA for `mint` / `owner` and checks it holds exactly the bytes derived beforehand.
async function expectDerivedDataMatchesChain(
    client: TestClient,
    mint: Address,
    owner: Address,
    tokenProgram: Address = TOKEN_2022_PROGRAM_ADDRESS,
) {
    const derived = await getNewAssociatedTokenAccountDataAsync(client.rpc, mint, owner);
    await client.sendTransaction([
        await getCreateAssociatedTokenIdempotentInstructionAsync({
            payer: client.payer,
            mint,
            owner,
            tokenProgram,
        }),
    ]);
    const [ata] = await findAssociatedTokenPda({ mint, owner, tokenProgram });
    const onChain = await fetchEncodedAccount(client.rpc, ata);
    assertAccountExists(onChain);
    expect(Buffer.from(derived).toString('hex')).toBe(Buffer.from(onChain.data).toString('hex'));
}

describe('transfer hook with an account-data seed on a destination that does not exist yet', () => {
    it('fails to resolve the extra accounts against an uncreated destination', async () => {
        const { client, decimals, destination, mint, source, sourceOwner } = await setupHookMintWithAccountDataSeed();

        // When the client resolves the hook's extra accounts, the account-data seed sends it to the
        // RPC for a destination that will not exist until the transfer's own transaction runs.
        await expect(
            client.token2022.instructions.transferCheckedWithTransferHook({
                source,
                mint: mint.address,
                destination,
                authority: sourceOwner,
                amount: 40n,
                decimals,
            }),
        ).rejects.toThrow(`account ${destination} required by an account-data seed was not found`);
    });

    it('resolves and executes once the destination has been created by an earlier transaction', async () => {
        const { client, decimals, destination, destinationOwner, mint, source, sourceOwner } =
            await setupHookMintWithAccountDataSeed();

        // Given the destination created ahead of time, in its own transaction.
        await client.sendTransaction([
            await getCreateAssociatedTokenIdempotentInstructionAsync({
                payer: client.payer,
                mint: mint.address,
                owner: destinationOwner.address,
            }),
        ]);

        // Then the unmodified helper resolves the account-data seed over RPC and the transfer runs.
        await client.token2022.instructions
            .transferCheckedWithTransferHook({
                source,
                mint: mint.address,
                destination,
                authority: sourceOwner,
                amount: 40n,
                decimals,
            })
            .sendTransaction();

        const [{ data: sourceData }, { data: destinationData }] = await Promise.all([
            fetchToken(client.rpc, source),
            fetchToken(client.rpc, destination),
        ]);
        expect(sourceData).toMatchObject(<Token>{ amount: 60n });
        expect(destinationData).toMatchObject(<Token>{ amount: 40n });
    });

    it('executes when the destination is created earlier in the same transaction', async () => {
        const { client, decimals, destination, destinationOwner, mint, source, sourceOwner } =
            await setupHookMintWithAccountDataSeed();

        const createDestination = await getCreateAssociatedTokenIdempotentInstructionAsync({
            payer: client.payer,
            mint: mint.address,
            owner: destinationOwner.address,
        });

        // Given the destination's wallet, the helper derives the state the ATA is about to hold and
        // resolves the account-data seed against it instead of fetching it.
        const transfer = await client.token2022.instructions.transferCheckedWithTransferHook(
            {
                source,
                mint: mint.address,
                destination,
                authority: sourceOwner,
                amount: 40n,
                decimals,
            },
            { recipient: destinationOwner.address },
        );

        // Then creating the destination and transferring in one transaction succeeds: the hook
        // resolves the same seed on chain, by which point the destination holds its owner.
        await client.sendTransaction([createDestination, transfer]);

        const [{ data: sourceData }, { data: destinationData }] = await Promise.all([
            fetchToken(client.rpc, source),
            fetchToken(client.rpc, destination),
        ]);
        expect(sourceData).toMatchObject(<Token>{ amount: 60n });
        expect(destinationData).toMatchObject(<Token>{ amount: 40n });
    });

    it('rejects a recipient whose associated token account is not the destination', async () => {
        const { client, decimals, destination, mint, source, sourceOwner } = await setupHookMintWithAccountDataSeed();

        // A recipient that does not own the destination would derive a PDA the hook will not, so the
        // helper refuses to build the instruction rather than leaving it to fail on chain.
        await expect(
            client.token2022.instructions.transferCheckedWithTransferHook(
                { source, mint: mint.address, destination, authority: sourceOwner, amount: 40n, decimals },
                { recipient: sourceOwner.address },
            ),
        ).rejects.toThrow(`${sourceOwner.address} does not own the destination ${destination}`);
    });

    it('derives the exact state the associated token program writes for the destination', async () => {
        const { client, destination, destinationOwner, mint } = await setupHookMintWithAccountDataSeed();

        // What the helper resolves seeds against, for a destination that does not exist yet.
        const derived = await getNewAssociatedTokenAccountDataAsync(client.rpc, mint.address, destinationOwner.address);

        await client.sendTransaction([
            await getCreateAssociatedTokenIdempotentInstructionAsync({
                payer: client.payer,
                mint: mint.address,
                owner: destinationOwner.address,
            }),
        ]);

        // Byte for byte what the chain actually holds, extensions included. Any divergence would
        // derive a different PDA than the hook does and the transfer would fail on chain.
        const onChain = await fetchEncodedAccount(client.rpc, destination);
        assertAccountExists(onChain);
        expect(Buffer.from(derived).toString('hex')).toBe(Buffer.from(onChain.data).toString('hex'));
    });

    it('is rejected on chain when the resolved extra account is not the one the hook derives', async () => {
        const { client, decimals, destination, destinationOwner, mint, source, sourceOwner } =
            await setupHookMintWithAccountDataSeed();

        const createDestination = await getCreateAssociatedTokenIdempotentInstructionAsync({
            payer: client.payer,
            mint: mint.address,
            owner: destinationOwner.address,
        });
        const transfer = await client.token2022.instructions.transferCheckedWithTransferHook(
            { source, mint: mint.address, destination, authority: sourceOwner, amount: 40n, decimals },
            { recipient: destinationOwner.address },
        );

        // Swap the resolved PDA (the extra accounts end with the hook program and its validation
        // account) for one seeded by the source owner instead of the destination's.
        const [wrongPda] = await getProgramDerivedAddress({
            programAddress: TRANSFER_HOOK_PROGRAM_ADDRESS,
            seeds: [getAddressEncoder().encode(sourceOwner.address)],
        });
        const accounts = [...(transfer.accounts ?? [])];
        const pdaIndex = accounts.length - 3;
        accounts[pdaIndex] = { ...accounts[pdaIndex], address: wrongPda };

        // Then the hook re-derives the seed from the real account data and rejects the transfer, so
        // the passing cases above are not passing on a hook that ignores its extra account.
        // Instruction #2 is the transfer; a client-side failure would not reach the chain at all.
        await expect(client.sendTransaction([createDestination, { ...transfer, accounts }])).rejects.toThrow(
            /Custom program error.*instruction #2/,
        );

        expect((await fetchToken(client.rpc, source)).data).toMatchObject(<Token>{ amount: 100n });
    });
    it("derives the mint's default account state instead of assuming the account starts initialized", async () => {
        const client = await createTestClient();
        const [mintAuthority, freezeAuthority, destinationOwner, mint] = await Promise.all([
            generateKeyPairSigner(),
            generateKeyPairSigner(),
            generateKeyPairSigner(),
            generateKeyPairSigner(),
        ]);

        // A hook mint whose new accounts are frozen on creation. `state` sits at byte 108 of the
        // base layout, so a seed reading it resolves to a different PDA than one over an
        // initialized account.
        await client.token2022.instructions
            .createMint({
                newMint: mint,
                decimals: 2,
                mintAuthority,
                freezeAuthority: freezeAuthority.address,
                extensions: [
                    extension('TransferHook', {
                        authority: mintAuthority.address,
                        programId: TRANSFER_HOOK_PROGRAM_ADDRESS,
                    }),
                    extension('DefaultAccountState', { state: AccountState.Frozen }),
                ],
            })
            .sendTransaction();

        const derived = await getNewAssociatedTokenAccountDataAsync(client.rpc, mint.address, destinationOwner.address);

        await client.sendTransaction([
            await getCreateAssociatedTokenIdempotentInstructionAsync({
                payer: client.payer,
                mint: mint.address,
                owner: destinationOwner.address,
            }),
        ]);
        const [destination] = await findAssociatedTokenPda({
            mint: mint.address,
            owner: destinationOwner.address,
            tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        });

        const onChain = await fetchEncodedAccount(client.rpc, destination);
        assertAccountExists(onChain);
        expect(Buffer.from(derived).toString('hex')).toBe(Buffer.from(onChain.data).toString('hex'));

        // And the chain really did write Frozen, so the comparison above is not the initialized
        // case passing under a different name.
        expect((await fetchToken(client.rpc, destination)).data.state).toBe(AccountState.Frozen);
    });

    it('refuses to derive a new account for the native mint', async () => {
        const client = await createTestClient();
        const owner = await generateKeyPairSigner();

        // A native account's `isNative` holds a rent-exempt reserve taken from its own lamports,
        // which the mint does not determine. Guessing it would resolve seeds against wrong bytes.
        await expect(
            getNewAssociatedTokenAccountDataAsync(client.rpc, NATIVE_MINT_ADDRESS, owner.address),
        ).rejects.toThrow(/native mint/);
    });
    it('executes when the destination address already holds lamports before it is created', async () => {
        const { client, decimals, destination, destinationOwner, mint, source, sourceOwner } =
            await setupHookMintWithAccountDataSeed();

        // Given SOL sent to the future ATA, so the address exists as an empty system account.
        await client.airdrop(destination, lamports(1_000_000n));

        const createDestination = await getCreateAssociatedTokenIdempotentInstructionAsync({
            payer: client.payer,
            mint: mint.address,
            owner: destinationOwner.address,
        });
        const transfer = await client.token2022.instructions.transferCheckedWithTransferHook(
            { source, mint: mint.address, destination, authority: sourceOwner, amount: 40n, decimals },
            { recipient: destinationOwner.address },
        );
        await client.sendTransaction([createDestination, transfer]);

        expect((await fetchToken(client.rpc, destination)).data).toMatchObject(<Token>{ amount: 40n });
    });

    it('creates the destination and runs the hook through transferToATA', async () => {
        const { client, decimals, destination, destinationOwner, mint, source, sourceOwner } =
            await setupHookMintWithAccountDataSeed();

        await client.token2022.instructions
            .transferToATA({
                mint: mint.address,
                source,
                authority: sourceOwner,
                recipient: destinationOwner.address,
                amount: 40n,
                decimals,
            })
            .sendTransaction();

        expect((await fetchToken(client.rpc, destination)).data).toMatchObject(<Token>{ amount: 40n });
    });

    it('rejects a mismatched recipient even when the mint has no transfer hook', async () => {
        const client = await createTestClient();
        const [mintAuthority, owner, recipient, mint] = await Promise.all([
            generateKeyPairSigner(),
            generateKeyPairSigner(),
            generateKeyPairSigner(),
            generateKeyPairSigner(),
        ]);
        await client.token2022.instructions.createMint({ newMint: mint, decimals: 2, mintAuthority }).sendTransaction();
        const [destination] = await findAssociatedTokenPda({
            mint: mint.address,
            owner: owner.address,
            tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        });

        await expect(
            client.token2022.instructions.transferCheckedWithTransferHook(
                { source: destination, mint: mint.address, destination, authority: owner, amount: 1n, decimals: 2 },
                { recipient: recipient.address },
            ),
        ).rejects.toThrow(`${recipient.address} does not own the destination ${destination}`);
    });

    it.each<[string, ExtensionArgs[]]>([
        ['NonTransferable', [extension('NonTransferable', {})]],
        [
            'TransferFeeConfig',
            [
                extension('TransferFeeConfig', {
                    transferFeeConfigAuthority: TRANSFER_HOOK_PROGRAM_ADDRESS,
                    withdrawWithheldAuthority: TRANSFER_HOOK_PROGRAM_ADDRESS,
                    withheldAmount: 0n,
                    olderTransferFee: { epoch: 0n, maximumFee: 10n, transferFeeBasisPoints: 100 },
                    newerTransferFee: { epoch: 0n, maximumFee: 10n, transferFeeBasisPoints: 100 },
                }),
            ],
        ],
        [
            'PausableConfig',
            [extension('PausableConfig', { authority: some(TRANSFER_HOOK_PROGRAM_ADDRESS), paused: false })],
        ],
        [
            'all of them with a transfer hook',
            [
                extension('TransferFeeConfig', {
                    transferFeeConfigAuthority: TRANSFER_HOOK_PROGRAM_ADDRESS,
                    withdrawWithheldAuthority: TRANSFER_HOOK_PROGRAM_ADDRESS,
                    withheldAmount: 0n,
                    olderTransferFee: { epoch: 0n, maximumFee: 10n, transferFeeBasisPoints: 100 },
                    newerTransferFee: { epoch: 0n, maximumFee: 10n, transferFeeBasisPoints: 100 },
                }),
                extension('NonTransferable', {}),
                extension('TransferHook', {
                    authority: TRANSFER_HOOK_PROGRAM_ADDRESS,
                    programId: TRANSFER_HOOK_PROGRAM_ADDRESS,
                }),
                extension('PausableConfig', { authority: some(TRANSFER_HOOK_PROGRAM_ADDRESS), paused: false }),
            ],
        ],
    ])('derives the exact new account data for a mint with %s', async (_, extensions) => {
        const client = await createTestClient();
        const [mintAuthority, owner, mint] = await Promise.all([
            generateKeyPairSigner(),
            generateKeyPairSigner(),
            generateKeyPairSigner(),
        ]);
        await client.token2022.instructions
            .createMint({ newMint: mint, decimals: 2, mintAuthority, extensions })
            .sendTransaction();

        await expectDerivedDataMatchesChain(client, mint.address, owner.address);
    });

    it('derives the exact new account data for a classic token mint', async () => {
        const client = await createTestClient();
        const [mintAuthority, owner, mint] = await Promise.all([
            generateKeyPairSigner(),
            generateKeyPairSigner(),
            generateKeyPairSigner(),
        ]);
        await client.token2022.instructions
            .createMint({ newMint: mint, decimals: 2, mintAuthority }, { tokenProgram: TOKEN_PROGRAM_ADDRESS })
            .sendTransaction();

        await expectDerivedDataMatchesChain(client, mint.address, owner.address, TOKEN_PROGRAM_ADDRESS);
    });
});
