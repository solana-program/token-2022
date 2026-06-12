import { expect, it } from 'vitest';
import { getCreateAccountInstruction } from '@solana-program/system';
import {
    AccountRole,
    decompileTransactionMessage,
    generateKeyPairSigner,
    getBase64Encoder,
    getCompiledTransactionMessageDecoder,
    getTransactionDecoder,
    Instruction,
    InstructionWithData,
    none,
    ReadonlyUint8Array,
    some,
} from '@solana/kit';
import {
    AccountState,
    fetchMint,
    fetchToken,
    getBatchInstruction,
    getInitializeAccount3Instruction,
    getInitializeMint2Instruction,
    getMintSize,
    getMintToInstruction,
    getTokenSize,
    Mint,
    parseBatchInstruction,
    Token,
    Token2022Instruction,
    TOKEN_2022_PROGRAM_ADDRESS,
} from '../src';
import { createDefaultSolanaClient, generateKeyPairSignerWithSol, sendAndConfirmInstructions } from './_setup';

it('batches multiple token instructions together', async () => {
    // Given a client with some generated keypairs.
    const client = createDefaultSolanaClient();
    const [payer, mint, token, mintAuthority, tokenOwner] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const mintSize = getMintSize();
    const tokenSize = getTokenSize();
    const [mintRent, tokenRent] = await Promise.all([
        client.rpc.getMinimumBalanceForRentExemption(BigInt(mintSize)).send(),
        client.rpc.getMinimumBalanceForRentExemption(BigInt(tokenSize)).send(),
    ]);

    // When we send a transaction with multiple token instructions batched together.
    await sendAndConfirmInstructions(client, payer, [
        getCreateAccountInstruction({
            payer,
            newAccount: mint,
            space: mintSize,
            lamports: mintRent,
            programAddress: TOKEN_2022_PROGRAM_ADDRESS,
        }),
        getCreateAccountInstruction({
            payer,
            newAccount: token,
            space: tokenSize,
            lamports: tokenRent,
            programAddress: TOKEN_2022_PROGRAM_ADDRESS,
        }),
        getBatchInstruction([
            getInitializeMint2Instruction({
                mint: mint.address,
                decimals: 2,
                mintAuthority: mintAuthority.address,
            }),
            getInitializeAccount3Instruction({
                account: token.address,
                mint: mint.address,
                owner: tokenOwner.address,
            }),
            getMintToInstruction({
                mint: mint.address,
                token: token.address,
                mintAuthority,
                amount: 123_45,
            }),
        ]),
    ]);

    // Then we expect the mint account to have the correct data.
    const { data: mintData } = await fetchMint(client.rpc, mint.address);
    expect(mintData).toMatchObject(<Mint>{
        mintAuthority: some(mintAuthority.address),
        supply: 123_45n,
        decimals: 2,
        isInitialized: true,
        freezeAuthority: none(),
    });

    // And we expect the token account to have the correct data.
    const { data: tokenData } = await fetchToken(client.rpc, token.address);
    expect(tokenData).toMatchObject(<Token>{
        mint: mint.address,
        owner: tokenOwner.address,
        amount: 123_45n,
        state: AccountState.Initialized,
    });
});

it('fails to batch nested batch instructions', async () => {
    // Given some generated keypairs.
    const [mint, token, mintAuthority, tokenOwner] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // When we try to create a batch instruction that contains another batch instruction as a child.
    const createNestedBatch = () =>
        getBatchInstruction([
            // @ts-expect-error - We expect a TypeScript error because batch instructions cannot be nested.
            getBatchInstruction([
                getInitializeMint2Instruction({
                    mint: mint.address,
                    decimals: 2,
                    mintAuthority: mintAuthority.address,
                }),
                getInitializeAccount3Instruction({
                    account: token.address,
                    mint: mint.address,
                    owner: tokenOwner.address,
                }),
            ]),
            getMintToInstruction({
                mint: mint.address,
                token: token.address,
                mintAuthority,
                amount: 123_45,
            }),
        ]);

    // Then we expect an error to be thrown.
    expect(createNestedBatch).toThrow('Batch instructions cannot be nested within other batch instructions.');
});

it('parses batch instructions including its inner instructions', async () => {
    // Given a batch instruction with multiple token inner instructions.
    const [mint, token, mintAuthority, tokenOwner] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const batchInstruction = getBatchInstruction([
        getInitializeMint2Instruction({
            mint: mint.address,
            decimals: 2,
            mintAuthority: mintAuthority.address,
        }),
        getInitializeAccount3Instruction({
            account: token.address,
            mint: mint.address,
            owner: tokenOwner.address,
        }),
        getMintToInstruction({
            mint: mint.address,
            token: token.address,
            mintAuthority,
            amount: 123_45,
        }),
    ]);

    // When we parse the batch instruction.
    const parsedInstruction = parseBatchInstruction(batchInstruction);

    // Then we expect the parsed instruction to have the following inner instructions.
    expect(parsedInstruction.instructions).toEqual([
        {
            instructionType: Token2022Instruction.InitializeMint2,
            programAddress: TOKEN_2022_PROGRAM_ADDRESS,
            accounts: {
                mint: { address: mint.address, role: AccountRole.WRITABLE },
            },
            data: {
                decimals: 2,
                discriminator: 20,
                freezeAuthority: none(),
                mintAuthority: mintAuthority.address,
            },
        },
        {
            instructionType: Token2022Instruction.InitializeAccount3,
            programAddress: TOKEN_2022_PROGRAM_ADDRESS,
            accounts: {
                account: { address: token.address, role: AccountRole.WRITABLE },
                mint: { address: mint.address, role: AccountRole.READONLY },
            },
            data: {
                discriminator: 18,
                owner: tokenOwner.address,
            },
        },
        {
            instructionType: Token2022Instruction.MintTo,
            programAddress: TOKEN_2022_PROGRAM_ADDRESS,
            accounts: {
                mint: { address: mint.address, role: AccountRole.WRITABLE },
                mintAuthority: {
                    address: mintAuthority.address,
                    role: AccountRole.READONLY_SIGNER,
                    signer: mintAuthority,
                },
                token: { address: token.address, role: AccountRole.WRITABLE },
            },
            data: {
                amount: 123_45n,
                discriminator: 7,
            },
        },
    ]);
});

it('parses batch instructions from a fetched transaction', async () => {
    // Given a client with some generated keypairs.
    const client = createDefaultSolanaClient();
    const [payer, mint, token, mintAuthority, tokenOwner] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const mintSize = getMintSize();
    const tokenSize = getTokenSize();
    const [mintRent, tokenRent] = await Promise.all([
        client.rpc.getMinimumBalanceForRentExemption(BigInt(mintSize)).send(),
        client.rpc.getMinimumBalanceForRentExemption(BigInt(tokenSize)).send(),
    ]);

    // And a sent transaction with a batch instruction.
    const signature = await sendAndConfirmInstructions(client, payer, [
        getCreateAccountInstruction({
            payer,
            newAccount: mint,
            space: mintSize,
            lamports: mintRent,
            programAddress: TOKEN_2022_PROGRAM_ADDRESS,
        }),
        getCreateAccountInstruction({
            payer,
            newAccount: token,
            space: tokenSize,
            lamports: tokenRent,
            programAddress: TOKEN_2022_PROGRAM_ADDRESS,
        }),
        getBatchInstruction([
            getInitializeMint2Instruction({
                mint: mint.address,
                decimals: 2,
                mintAuthority: mintAuthority.address,
            }),
            getInitializeAccount3Instruction({
                account: token.address,
                mint: mint.address,
                owner: tokenOwner.address,
            }),
            getMintToInstruction({
                mint: mint.address,
                token: token.address,
                mintAuthority,
                amount: 123_45,
            }),
        ]),
    ]);

    // And given we access the batch instruction from the fetched transaction.
    const transactionResult = await client.rpc
        .getTransaction(signature, { encoding: 'base64', maxSupportedTransactionVersion: 0 })
        .send();
    expect(transactionResult).toBeTruthy();
    const transactionBytes = getBase64Encoder().encode(transactionResult!.transaction[0]);
    const transaction = getTransactionDecoder().decode(transactionBytes);
    const compiledMessage = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    const message = decompileTransactionMessage(compiledMessage);
    const batchInstruction = message.instructions.find(
        instruction => instruction.programAddress === TOKEN_2022_PROGRAM_ADDRESS,
    ) as Instruction & InstructionWithData<ReadonlyUint8Array>;

    // When we parse the batch instruction.
    const parsedInstruction = parseBatchInstruction(batchInstruction);

    // Then we expect the parsed instruction to have the following inner instructions.
    expect(parsedInstruction.instructions).toEqual([
        {
            instructionType: Token2022Instruction.InitializeMint2,
            programAddress: TOKEN_2022_PROGRAM_ADDRESS,
            accounts: {
                mint: { address: mint.address, role: AccountRole.WRITABLE_SIGNER },
            },
            data: {
                decimals: 2,
                discriminator: 20,
                freezeAuthority: none(),
                mintAuthority: mintAuthority.address,
            },
        },
        {
            instructionType: Token2022Instruction.InitializeAccount3,
            programAddress: TOKEN_2022_PROGRAM_ADDRESS,
            accounts: {
                account: { address: token.address, role: AccountRole.WRITABLE_SIGNER },
                mint: { address: mint.address, role: AccountRole.WRITABLE_SIGNER },
            },
            data: {
                discriminator: 18,
                owner: tokenOwner.address,
            },
        },
        {
            instructionType: Token2022Instruction.MintTo,
            programAddress: TOKEN_2022_PROGRAM_ADDRESS,
            accounts: {
                mint: { address: mint.address, role: AccountRole.WRITABLE_SIGNER },
                mintAuthority: { address: mintAuthority.address, role: AccountRole.READONLY_SIGNER },
                token: { address: token.address, role: AccountRole.WRITABLE_SIGNER },
            },
            data: {
                amount: 123_45n,
                discriminator: 7,
            },
        },
    ]);
});
