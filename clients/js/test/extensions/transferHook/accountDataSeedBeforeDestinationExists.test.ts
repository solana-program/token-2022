import path from 'node:path';

import {
    AccountRole,
    address,
    generateKeyPairSigner,
    getAddressEncoder,
    getProgramDerivedAddress,
    lamports,
} from '@solana/kit';
import { describe, expect, it } from 'vitest';

import {
    TOKEN_2022_PROGRAM_ADDRESS,
    Token,
    extension,
    fetchToken,
    findAssociatedTokenPda,
    findExtraAccountMetaListPda,
    getCreateAssociatedTokenIdempotentInstructionAsync,
    getDefaultInitializeExtraAccountMetaListInstructionAsync,
    getTransferCheckedInstruction,
} from '../../../src';
import { createTestClient, createTokenWithAmount } from '../../_setup';

const TRANSFER_HOOK_PROGRAM_ADDRESS = address('TokenHookExampLe8smaVNrxTBezWTRbEwxwb1Zykrb');
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

    it('executes when the destination is created earlier in the same transaction and the seed is resolved locally', async () => {
        const { client, decimals, destination, destinationOwner, mint, source, sourceOwner, validateStatePubkey } =
            await setupHookMintWithAccountDataSeed();

        // A newly created ATA's `owner` is known ahead of time, so the seed resolves locally and the
        // PDA derives without the account existing.
        const [extraAccount] = await getProgramDerivedAddress({
            programAddress: TRANSFER_HOOK_PROGRAM_ADDRESS,
            seeds: [getAddressEncoder().encode(destinationOwner.address)],
        });

        const createDestination = await getCreateAssociatedTokenIdempotentInstructionAsync({
            payer: client.payer,
            mint: mint.address,
            owner: destinationOwner.address,
        });

        const transfer = getTransferCheckedInstruction({
            amount: 40n,
            authority: sourceOwner,
            decimals,
            destination,
            mint: mint.address,
            source,
        });
        const transferWithHookAccounts = {
            ...transfer,
            accounts: [
                ...transfer.accounts,
                { address: extraAccount, role: AccountRole.READONLY },
                { address: TRANSFER_HOOK_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: validateStatePubkey, role: AccountRole.READONLY },
            ],
        };

        // Then creating the destination and transferring in one transaction succeeds: the hook
        // resolves the same seed on chain, by which point the destination holds its owner.
        await client.sendTransaction([createDestination, transferWithHookAccounts]);

        const [{ data: sourceData }, { data: destinationData }] = await Promise.all([
            fetchToken(client.rpc, source),
            fetchToken(client.rpc, destination),
        ]);
        expect(sourceData).toMatchObject(<Token>{ amount: 60n });
        expect(destinationData).toMatchObject(<Token>{ amount: 40n });
    });
});
