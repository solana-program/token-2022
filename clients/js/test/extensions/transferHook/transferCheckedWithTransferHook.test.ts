import { getTransferSolInstruction, SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import {
    type AccountMeta,
    AccountRole,
    type AccountSignerMeta,
    type Address,
    address,
    fixEncoderSize,
    generateKeyPairSigner,
    getAddressEncoder,
    getArrayEncoder,
    getBytesEncoder,
    getProgramDerivedAddress,
    getU32Encoder,
    getUtf8Encoder,
    type Instruction,
    isSolanaError,
    lamports,
    SOLANA_ERROR__INSTRUCTION_ERROR__MISSING_ACCOUNT,
    type TransactionSigner,
} from '@solana/kit';
import test from 'ava';
import {
    extension,
    type ExtraAccountMeta,
    fetchToken,
    findExtraAccountMetasPda,
    getExtraAccountMetaEncoder,
    getTransferCheckedWithTransferHookInstructionAsync,
    type Token,
} from '../../../src';
import {
    type Client,
    createDefaultSolanaClient,
    createMint,
    createToken,
    createTokenWithAmount,
    generateKeyPairSignerWithSol,
    sendAndConfirmInstructions,
} from '../../_setup';

const TRANSFER_HOOK_TEST_PROGRAM_ID = address('TokenHookExampLe8smaVNrxTBezWTRbEwxwb1Zykrb');

// sha256("spl-transfer-hook-interface:initialize-extra-account-metas")[0..8]
const INITIALIZE_EXTRA_ACCOUNT_METAS_DISCRIMINATOR = new Uint8Array([43, 34, 13, 49, 167, 88, 235, 235]);

function getInitializeExtraAccountMetaListInstruction(input: {
    authority: TransactionSigner;
    extraAccountMetas: ExtraAccountMeta[];
    mint: Address;
    validationAccount: Address;
}): Instruction {
    const metasData = getArrayEncoder(getExtraAccountMetaEncoder(), { size: getU32Encoder() }).encode(
        input.extraAccountMetas,
    );
    const data = new Uint8Array(8 + metasData.length);
    data.set(INITIALIZE_EXTRA_ACCOUNT_METAS_DISCRIMINATOR, 0);
    data.set(metasData, 8);

    const accounts: (AccountMeta | AccountSignerMeta)[] = [
        { address: input.validationAccount, role: AccountRole.WRITABLE },
        { address: input.mint, role: AccountRole.READONLY },
        { address: input.authority.address, role: AccountRole.READONLY_SIGNER, signer: input.authority },
        { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ];

    return { accounts, data, programAddress: TRANSFER_HOOK_TEST_PROGRAM_ID };
}

async function createMintWithTransferHook(client: Client, authority: TransactionSigner) {
    return await createMint({
        authority,
        client,
        decimals: 2,
        extensions: [
            extension('TransferHook', {
                authority: authority.address,
                programId: TRANSFER_HOOK_TEST_PROGRAM_ID,
            }),
        ],
        payer: authority,
    });
}

test('it transfers tokens by resolving the extra accounts required by the transfer hook', async t => {
    // Given some signer accounts.
    const client = createDefaultSolanaClient();
    const [authority, destinationOwner] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSigner(),
    ]);

    // And a mint with a transfer hook pointing at the example hook program.
    const mint = await createMintWithTransferHook(client, authority);

    // And source and destination token accounts with transfer hook extensions.
    const transferHookAccount = extension('TransferHookAccount', { transferring: false });
    const [source, destination] = await Promise.all([
        createTokenWithAmount({
            amount: 1000n,
            client,
            extensions: [transferHookAccount],
            mint,
            mintAuthority: authority,
            owner: authority,
            payer: authority,
        }),
        createToken({
            client,
            extensions: [transferHookAccount],
            mint,
            owner: destinationOwner,
            payer: authority,
        }),
    ]);

    // And a validation account listing a fixed extra account and a seed-derived PDA.
    const validationAccount = (
        await findExtraAccountMetasPda({ mint }, { programAddress: TRANSFER_HOOK_TEST_PROGRAM_ID })
    )[0];
    const fixedExtraAccount = address('GLQGTjqsTaxjqkqKra2J9C2oTLAW8KPS3SBVLpEsbBED');
    const pdaSeedsConfig = fixEncoderSize(getBytesEncoder(), 32).encode(
        new Uint8Array([1, 6, ...getUtf8Encoder().encode('prefix'), 3, 0]),
    );
    await sendAndConfirmInstructions(client, authority, [
        getInitializeExtraAccountMetaListInstruction({
            authority,
            extraAccountMetas: [
                {
                    addressConfig: getAddressEncoder().encode(fixedExtraAccount),
                    discriminator: 0,
                    isSigner: false,
                    isWritable: false,
                },
                {
                    addressConfig: pdaSeedsConfig,
                    discriminator: 1,
                    isSigner: false,
                    isWritable: false,
                },
            ],
            mint,
            validationAccount,
        }),
        getTransferSolInstruction({
            amount: lamports(10_000_000n),
            destination: validationAccount,
            source: authority,
        }),
    ]);

    // When we build and send a transfer using the transfer hook helper.
    const transferInstruction = await getTransferCheckedWithTransferHookInstructionAsync(client.rpc, {
        amount: 100n,
        authority,
        decimals: 2,
        destination,
        mint,
        source,
    });
    await sendAndConfirmInstructions(client, authority, [transferInstruction]);

    // Then the helper resolved the hook accounts onto the instruction.
    const [expectedPda] = await getProgramDerivedAddress({
        programAddress: TRANSFER_HOOK_TEST_PROGRAM_ID,
        seeds: ['prefix', getAddressEncoder().encode(source)],
    });
    const appendedAddresses = (transferInstruction.accounts ?? []).slice(4).map(meta => meta.address);
    t.deepEqual(appendedAddresses, [fixedExtraAccount, expectedPda, TRANSFER_HOOK_TEST_PROGRAM_ID, validationAccount]);

    // And we expect the tokens to have been transferred.
    const [{ data: sourceData }, { data: destinationData }] = await Promise.all([
        fetchToken(client.rpc, source),
        fetchToken(client.rpc, destination),
    ]);
    t.like(sourceData, <Token>{ amount: 900n });
    t.like(destinationData, <Token>{ amount: 100n });
});

test('it fails to transfer when the hook accounts are not forwarded', async t => {
    // Given some signer accounts.
    const client = createDefaultSolanaClient();
    const [authority, destinationOwner] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSigner(),
    ]);

    // And a mint with a transfer hook pointing at the example hook program.
    const mint = await createMintWithTransferHook(client, authority);

    const transferHookAccount = extension('TransferHookAccount', { transferring: false });
    const [source, destination] = await Promise.all([
        createTokenWithAmount({
            amount: 1000n,
            client,
            extensions: [transferHookAccount],
            mint,
            mintAuthority: authority,
            owner: authority,
            payer: authority,
        }),
        createToken({
            client,
            extensions: [transferHookAccount],
            mint,
            owner: destinationOwner,
            payer: authority,
        }),
    ]);

    const validationAccount = (
        await findExtraAccountMetasPda({ mint }, { programAddress: TRANSFER_HOOK_TEST_PROGRAM_ID })
    )[0];
    const fixedExtraAccount = address('GLQGTjqsTaxjqkqKra2J9C2oTLAW8KPS3SBVLpEsbBED');
    await sendAndConfirmInstructions(client, authority, [
        getInitializeExtraAccountMetaListInstruction({
            authority,
            extraAccountMetas: [
                {
                    addressConfig: getAddressEncoder().encode(fixedExtraAccount),
                    discriminator: 0,
                    isSigner: false,
                    isWritable: false,
                },
            ],
            mint,
            validationAccount,
        }),
        getTransferSolInstruction({
            amount: lamports(10_000_000n),
            destination: validationAccount,
            source: authority,
        }),
    ]);

    // When we send a transfer without the resolved hook accounts.
    const transferInstruction = await getTransferCheckedWithTransferHookInstructionAsync(client.rpc, {
        amount: 100n,
        authority,
        decimals: 2,
        destination,
        mint,
        source,
    });
    const strippedInstruction = {
        ...transferInstruction,
        accounts: (transferInstruction.accounts ?? []).slice(0, 4),
    };
    const promise = sendAndConfirmInstructions(client, authority, [strippedInstruction]);

    // Then we expect a missing-account error.
    const error = await t.throwsAsync(promise, { message: 'Transaction simulation failed' });
    t.true(isSolanaError(error?.cause, SOLANA_ERROR__INSTRUCTION_ERROR__MISSING_ACCOUNT));
});
