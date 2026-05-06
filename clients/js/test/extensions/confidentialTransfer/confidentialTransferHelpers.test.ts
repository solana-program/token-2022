import {
    Address,
    generateKeyPairSigner,
    getAddressDecoder,
    isSome,
    none,
    some,
    type ReadonlyUint8Array,
} from '@solana/kit';
import * as zk from '@solana/zk-sdk/node';
import test from 'ava';
import {
    type ConfidentialTransferInstructionPlan,
    type ConfidentialTransferZkClient,
    TOKEN_2022_PROGRAM_ADDRESS,
    extension,
    fetchToken,
    findAssociatedTokenPda,
    getApplyConfidentialPendingBalanceInstructionFromToken,
    getConfidentialDepositInstruction,
    getConfidentialTransferInstructions,
    getConfidentialWithdrawInstructions,
    getCreateConfidentialTransferAccountInstructions,
    getMintToInstruction,
    type Token,
} from '../../../src';
import {
    createDefaultSolanaClient,
    createMint,
    generateKeyPairSignerWithSol,
    sendAndConfirmInstructions,
} from '../../_setup';

const zkClient = zk as unknown as ConfidentialTransferZkClient;
const ADDRESS_DECODER = getAddressDecoder();

function toElGamalAddress(pubkey: zk.ElGamalPubkey): Address {
    return ADDRESS_DECODER.decode(pubkey.toBytes());
}

function getConfidentialTransferAccount(tokenAccount: Token) {
    if (!isSome(tokenAccount.extensions)) {
        throw new Error('Token account is missing extensions.');
    }

    const extension = tokenAccount.extensions.value.find(
        candidate => candidate.__kind === 'ConfidentialTransferAccount',
    );
    if (!extension || extension.__kind !== 'ConfidentialTransferAccount') {
        throw new Error('Token account is missing the ConfidentialTransferAccount extension.');
    }

    return extension;
}

function getElGamalCiphertext(bytes: ReadonlyUint8Array) {
    const ciphertext = zk.ElGamalCiphertext.fromBytes(new Uint8Array(bytes));
    if (!ciphertext) {
        throw new Error('Failed to deserialize ElGamal ciphertext bytes.');
    }
    return ciphertext;
}

function getAeCiphertext(bytes: ReadonlyUint8Array) {
    const ciphertext = zk.AeCiphertext.fromBytes(new Uint8Array(bytes));
    if (!ciphertext) {
        throw new Error('Failed to deserialize authenticated-encryption ciphertext bytes.');
    }
    return ciphertext;
}

function decryptAvailableBalance(tokenAccount: Token, aesKey: zk.AeKey) {
    return aesKey.decrypt(getAeCiphertext(getConfidentialTransferAccount(tokenAccount).decryptableAvailableBalance));
}

function decryptPendingBalance(tokenAccount: Token, secretKey: zk.ElGamalSecretKey) {
    const extension = getConfidentialTransferAccount(tokenAccount);
    const balanceLo = secretKey.decrypt(getElGamalCiphertext(extension.pendingBalanceLow));
    const balanceHi = secretKey.decrypt(getElGamalCiphertext(extension.pendingBalanceHigh));
    return (balanceHi << 16n) + balanceLo;
}

async function sendAndConfirmInstructionPlan(
    client: ReturnType<typeof createDefaultSolanaClient>,
    payer: Awaited<ReturnType<typeof generateKeyPairSignerWithSol>>,
    plan: ConfidentialTransferInstructionPlan,
) {
    for (const instructions of plan.setupInstructions) {
        await sendAndConfirmInstructions(client, payer, instructions);
    }
    await sendAndConfirmInstructions(client, payer, plan.instructions);
    for (const instructions of plan.cleanupInstructions) {
        await sendAndConfirmInstructions(client, payer, instructions);
    }
}

async function createConfidentialTransferMint(authority: Awaited<ReturnType<typeof generateKeyPairSignerWithSol>>) {
    const client = createDefaultSolanaClient();
    return await createMint({
        authority,
        client,
        decimals: 0,
        extensions: [
            extension('ConfidentialTransferMint', {
                authority: some(authority.address),
                autoApproveNewAccounts: true,
                auditorElgamalPubkey: none(),
            }),
        ],
        payer: authority,
    });
}

async function createConfiguredConfidentialAccount(input: {
    owner: Awaited<ReturnType<typeof generateKeyPairSignerWithSol>>;
    payer: Awaited<ReturnType<typeof generateKeyPairSignerWithSol>>;
    mint: Address;
    elgamalKeypair: zk.ElGamalKeypair;
    aesKey: zk.AeKey;
}) {
    const client = createDefaultSolanaClient();
    const token = (
        await findAssociatedTokenPda({
            owner: input.owner.address,
            tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
            mint: input.mint,
        })
    )[0];

    const instructions = await getCreateConfidentialTransferAccountInstructions({
        payer: input.payer,
        owner: input.owner,
        mint: input.mint,
        zk: zkClient,
        elgamalKeypair: input.elgamalKeypair,
        aesKey: input.aesKey,
    });
    await sendAndConfirmInstructions(client, input.payer, instructions);

    return token;
}

async function mintAndApplyConfidentialBalance(input: {
    payer: Awaited<ReturnType<typeof generateKeyPairSignerWithSol>>;
    owner: Awaited<ReturnType<typeof generateKeyPairSignerWithSol>>;
    mint: Address;
    token: Address;
    amount: bigint;
    elgamalKeypair: zk.ElGamalKeypair;
    aesKey: zk.AeKey;
}) {
    const client = createDefaultSolanaClient();
    await sendAndConfirmInstructions(client, input.payer, [
        getMintToInstruction({
            mint: input.mint,
            token: input.token,
            mintAuthority: input.payer,
            amount: input.amount,
        }),
        getConfidentialDepositInstruction({
            token: input.token,
            mint: input.mint,
            authority: input.owner,
            amount: input.amount,
            decimals: 0,
        }),
    ]);

    const depositedAccount = await fetchToken(client.rpc, input.token);
    await sendAndConfirmInstructions(client, input.payer, [
        getApplyConfidentialPendingBalanceInstructionFromToken({
            token: input.token,
            tokenAccount: depositedAccount.data,
            authority: input.owner,
            zk: zkClient,
            elgamalSecretKey: input.elgamalKeypair.secret(),
            aesKey: input.aesKey,
        }),
    ]);
}

test.serial('it creates and configures a confidential transfer account', async t => {
    const client = createDefaultSolanaClient();
    const [payer, owner] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSignerWithSol(client),
    ]);
    const mint = await createConfidentialTransferMint(payer);
    const elgamalKeypair = new zk.ElGamalKeypair();
    const aesKey = new zk.AeKey();

    const token = await createConfiguredConfidentialAccount({
        owner,
        payer,
        mint,
        elgamalKeypair,
        aesKey,
    });

    const tokenAccount = await fetchToken(client.rpc, token);
    const extension = getConfidentialTransferAccount(tokenAccount.data);

    t.true(extension.approved);
    t.is(extension.elgamalPubkey, toElGamalAddress(elgamalKeypair.pubkey()));
    t.is(decryptAvailableBalance(tokenAccount.data, aesKey), 0n);
    t.is(decryptPendingBalance(tokenAccount.data, elgamalKeypair.secret()), 0n);
});

test.serial('it rejects create helper authority that does not match the owner ATA flow', async t => {
    const [payer, owner, delegatedAuthority] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const elgamalKeypair = new zk.ElGamalKeypair();
    const aesKey = new zk.AeKey();

    await t.throwsAsync(
        () =>
            getCreateConfidentialTransferAccountInstructions({
                payer,
                owner,
                authority: delegatedAuthority,
                mint: payer.address,
                zk: zkClient,
                elgamalKeypair,
                aesKey,
            }),
        {
            message: /authority must match owner/i,
        },
    );
});

test.serial('it applies a pending confidential balance from decoded token state', async t => {
    const client = createDefaultSolanaClient();
    const [payer, owner] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSignerWithSol(client),
    ]);
    const mint = await createConfidentialTransferMint(payer);
    const elgamalKeypair = new zk.ElGamalKeypair();
    const aesKey = new zk.AeKey();

    const token = await createConfiguredConfidentialAccount({
        owner,
        payer,
        mint,
        elgamalKeypair,
        aesKey,
    });

    await sendAndConfirmInstructions(client, payer, [
        getMintToInstruction({
            mint,
            token,
            mintAuthority: payer,
            amount: 42n,
        }),
        getConfidentialDepositInstruction({
            token,
            mint,
            authority: owner,
            amount: 42n,
            decimals: 0,
        }),
    ]);

    const depositedAccount = await fetchToken(client.rpc, token);
    t.is(decryptPendingBalance(depositedAccount.data, elgamalKeypair.secret()), 42n);

    await sendAndConfirmInstructions(client, payer, [
        getApplyConfidentialPendingBalanceInstructionFromToken({
            token,
            tokenAccount: depositedAccount.data,
            authority: owner,
            zk: zkClient,
            elgamalSecretKey: elgamalKeypair.secret(),
            aesKey,
        }),
    ]);

    const appliedAccount = await fetchToken(client.rpc, token);
    t.is(appliedAccount.data.amount, 0n);
    t.is(decryptAvailableBalance(appliedAccount.data, aesKey), 42n);
    t.is(decryptPendingBalance(appliedAccount.data, elgamalKeypair.secret()), 0n);
});

test.serial('it withdraws a confidential balance with helper-generated proofs', async t => {
    const client = createDefaultSolanaClient();
    const [payer, owner] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSignerWithSol(client),
    ]);
    const mint = await createConfidentialTransferMint(payer);
    const elgamalKeypair = new zk.ElGamalKeypair();
    const aesKey = new zk.AeKey();

    const token = await createConfiguredConfidentialAccount({
        owner,
        payer,
        mint,
        elgamalKeypair,
        aesKey,
    });
    await mintAndApplyConfidentialBalance({
        payer,
        owner,
        mint,
        token,
        amount: 60n,
        elgamalKeypair,
        aesKey,
    });

    const sourceAccount = await fetchToken(client.rpc, token);
    const withdrawPlan = await getConfidentialWithdrawInstructions({
        payer,
        rpc: client.rpc,
        token,
        mint,
        tokenAccount: sourceAccount.data,
        authority: owner,
        amount: 25n,
        decimals: 0,
        zk: zkClient,
        elgamalKeypair,
        aesKey,
    });
    await sendAndConfirmInstructionPlan(client, payer, withdrawPlan);

    const withdrawnAccount = await fetchToken(client.rpc, token);
    t.is(withdrawnAccount.data.amount, 25n);
    t.is(decryptAvailableBalance(withdrawnAccount.data, aesKey), 35n);
});

test.serial('it rejects instruction-data proof mode for confidential withdraw', async t => {
    const [payer, owner] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    const elgamalKeypair = new zk.ElGamalKeypair();
    const aesKey = new zk.AeKey();

    await t.throwsAsync(
        () =>
            getConfidentialWithdrawInstructions({
                payer,
                rpc: createDefaultSolanaClient().rpc,
                token: payer.address,
                mint: owner.address,
                tokenAccount: {} as Token,
                authority: owner,
                amount: 1n,
                decimals: 0,
                zk: zkClient,
                elgamalKeypair,
                aesKey,
                proofMode: 'instruction-data',
            } as unknown as Parameters<typeof getConfidentialWithdrawInstructions>[0]),
        {
            message: /instruction-data proof mode is unsupported/i,
        },
    );
});

test.serial('it transfers confidential balance with helper-generated proofs', async t => {
    const client = createDefaultSolanaClient();
    const [payer, sourceOwner, destinationOwner] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSignerWithSol(client),
        generateKeyPairSignerWithSol(client),
    ]);
    const mint = await createConfidentialTransferMint(payer);
    const sourceElgamalKeypair = new zk.ElGamalKeypair();
    const sourceAeKey = new zk.AeKey();
    const destinationElgamalKeypair = new zk.ElGamalKeypair();
    const destinationAeKey = new zk.AeKey();

    const [sourceToken, destinationToken] = await Promise.all([
        createConfiguredConfidentialAccount({
            owner: sourceOwner,
            payer,
            mint,
            elgamalKeypair: sourceElgamalKeypair,
            aesKey: sourceAeKey,
        }),
        createConfiguredConfidentialAccount({
            owner: destinationOwner,
            payer,
            mint,
            elgamalKeypair: destinationElgamalKeypair,
            aesKey: destinationAeKey,
        }),
    ]);

    await mintAndApplyConfidentialBalance({
        payer,
        owner: sourceOwner,
        mint,
        token: sourceToken,
        amount: 90n,
        elgamalKeypair: sourceElgamalKeypair,
        aesKey: sourceAeKey,
    });

    const [sourceAccount, destinationAccount] = await Promise.all([
        fetchToken(client.rpc, sourceToken),
        fetchToken(client.rpc, destinationToken),
    ]);
    const transferPlan = await getConfidentialTransferInstructions({
        payer,
        rpc: client.rpc,
        sourceToken,
        mint,
        destinationToken,
        sourceTokenAccount: sourceAccount.data,
        destinationTokenAccount: destinationAccount.data,
        authority: sourceOwner,
        amount: 35n,
        zk: zkClient,
        sourceElgamalKeypair,
        aesKey: sourceAeKey,
    });
    await sendAndConfirmInstructionPlan(client, payer, transferPlan);

    const destinationAfterTransfer = await fetchToken(client.rpc, destinationToken);
    t.is(decryptPendingBalance(destinationAfterTransfer.data, destinationElgamalKeypair.secret()), 35n);

    await sendAndConfirmInstructions(client, payer, [
        getApplyConfidentialPendingBalanceInstructionFromToken({
            token: destinationToken,
            tokenAccount: destinationAfterTransfer.data,
            authority: destinationOwner,
            zk: zkClient,
            elgamalSecretKey: destinationElgamalKeypair.secret(),
            aesKey: destinationAeKey,
        }),
    ]);

    const [sourceAfterTransfer, destinationAfterApply] = await Promise.all([
        fetchToken(client.rpc, sourceToken),
        fetchToken(client.rpc, destinationToken),
    ]);
    t.is(decryptAvailableBalance(sourceAfterTransfer.data, sourceAeKey), 55n);
    t.is(decryptAvailableBalance(destinationAfterApply.data, destinationAeKey), 35n);
});

test.serial('it rejects instruction-data proof mode for confidential transfer', async t => {
    const [payer, owner] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    const sourceElgamalKeypair = new zk.ElGamalKeypair();
    const aesKey = new zk.AeKey();

    await t.throwsAsync(
        () =>
            getConfidentialTransferInstructions({
                payer,
                rpc: createDefaultSolanaClient().rpc,
                sourceToken: payer.address,
                mint: owner.address,
                destinationToken: payer.address,
                sourceTokenAccount: {} as Token,
                authority: owner,
                amount: 1n,
                zk: zkClient,
                sourceElgamalKeypair,
                aesKey,
                proofMode: 'instruction-data',
            } as unknown as Parameters<typeof getConfidentialTransferInstructions>[0]),
        {
            message: /instruction-data proof mode is unsupported/i,
        },
    );
});
