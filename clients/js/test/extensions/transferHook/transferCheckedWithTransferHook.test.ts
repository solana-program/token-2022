import path from 'node:path';

import { address, generateKeyPairSigner, lamports } from '@solana/kit';
import { describe, expect, it } from 'vitest';

import {
    extension,
    fetchToken,
    findExtraAccountMetaListPda,
    getDefaultInitializeExtraAccountMetaListInstructionAsync,
    Token,
} from '../../../src';
import { createTestClient, createTokenWithAmount } from '../../_setup';

// The `no_default_features` build of the SPL transfer hook example program accepts arbitrary mints
// (the default build hard-codes a single allowed mint), deployed at its conventional address.
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

describe('transferCheckedWithTransferHook', () => {
    it('resolves and executes a transfer through a real transfer hook program', async () => {
        // Given a mint whose transfer hook points at the deployed example program, with `mintAuthority`
        // as both the mint authority and the extra-account-meta-list authority.
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

        // Initialize the hook's validation account with one extra account (a literal pubkey), signed by
        // the mint authority. The program creates the PDA via `allocate`/`assign`, so fund it for rent
        // first.
        const extraAccount = address('AKPu7hnbAfsjixnPvGReDbmAYUJErkw8H6cRc3ohh2xf');
        const [validateStatePubkey] = await findExtraAccountMetaListPda(
            { mint: mint.address },
            { programAddress: TRANSFER_HOOK_PROGRAM_ADDRESS },
        );
        await client.airdrop(validateStatePubkey, lamports(1_000_000_000n));
        await client.sendTransaction(
            await getDefaultInitializeExtraAccountMetaListInstructionAsync({
                mint: mint.address,
                authority: mintAuthority,
                extraAccountMetas: [
                    { config: { __kind: 'Literal', address: extraAccount }, isSigner: false, isWritable: false },
                ],
                transferHookProgram: TRANSFER_HOOK_PROGRAM_ADDRESS,
            }),
        );

        // And a funded source token account plus an empty destination. Token accounts of a hook mint
        // carry the `TransferHookAccount` extension, so size them for it.
        const source = await createTokenWithAmount({
            client,
            payer: client.payer,
            mint: mint.address,
            owner: sourceOwner,
            mintAuthority,
            amount: 100n,
            extensions: [extension('TransferHookAccount', { transferring: false })],
        });
        const destination = await createTokenWithAmount({
            client,
            payer: client.payer,
            mint: mint.address,
            owner: destinationOwner,
            mintAuthority,
            amount: 0n,
            extensions: [extension('TransferHookAccount', { transferring: false })],
        });

        // When the source owner transfers 40 tokens, resolving and appending the hook's extra accounts.
        const transfer = client.token2022.instructions.transferCheckedWithTransferHook({
            source,
            mint: mint.address,
            destination,
            authority: sourceOwner,
            amount: 40n,
            decimals,
        });
        const instruction = await transfer;

        // The resolved instruction carries the base transfer accounts plus the hook's extra account,
        // its program, and its validation account.
        const resolvedAddresses = instruction.accounts?.map(account => account.address);
        expect(resolvedAddresses).toStrictEqual([
            source,
            mint.address,
            destination,
            sourceOwner.address,
            extraAccount,
            TRANSFER_HOOK_PROGRAM_ADDRESS,
            validateStatePubkey,
        ]);

        await transfer.sendTransaction();

        // Then the tokens move and the hook's `Execute` CPI succeeds.
        const [{ data: sourceData }, { data: destinationData }] = await Promise.all([
            fetchToken(client.rpc, source),
            fetchToken(client.rpc, destination),
        ]);
        expect(sourceData).toMatchObject(<Token>{ amount: 60n });
        expect(destinationData).toMatchObject(<Token>{ amount: 40n });
    });

    it('falls back to a plain checked transfer when the mint has no transfer hook', async () => {
        // Given a plain Token-2022 mint (no transfer hook) and a funded source account.
        const client = await createTestClient();
        const [mintAuthority, sourceOwner, destinationOwner, mint] = await Promise.all([
            generateKeyPairSigner(),
            generateKeyPairSigner(),
            generateKeyPairSigner(),
            generateKeyPairSigner(),
        ]);
        const decimals = 2;
        await client.token2022.instructions.createMint({ newMint: mint, decimals, mintAuthority }).sendTransaction();
        const source = await createTokenWithAmount({
            client,
            payer: client.payer,
            mint: mint.address,
            owner: sourceOwner,
            mintAuthority,
            amount: 100n,
        });
        const destination = await createTokenWithAmount({
            client,
            payer: client.payer,
            mint: mint.address,
            owner: destinationOwner,
            mintAuthority,
            amount: 0n,
        });

        // When the source owner transfers 40 tokens via the plugin helper.
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

        // Then the tokens move without any extra accounts, since the mint has no hook.
        const [{ data: sourceData }, { data: destinationData }] = await Promise.all([
            fetchToken(client.rpc, source),
            fetchToken(client.rpc, destination),
        ]);
        expect(sourceData).toMatchObject(<Token>{ amount: 60n });
        expect(destinationData).toMatchObject(<Token>{ amount: 40n });
    });
});
