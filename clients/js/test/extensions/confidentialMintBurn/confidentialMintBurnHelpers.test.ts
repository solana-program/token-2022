import { generateKeyPairSigner, getAddressDecoder, isSome, none, some, type ReadonlyUint8Array } from '@solana/kit';
import { AeCiphertext, ElGamalCiphertext, ElGamalKeypair, AeKey } from '@solana/zk-sdk/bundler';
import test from 'ava';
import {
    AccountState,
    Extension,
    Mint,
    Token,
    extension,
    fetchMint,
    fetchToken,
    getApplyConfidentialPendingBalanceInstructionFromToken,
    getApplyConfidentialPendingBurnInstructionPlan,
    getConfidentialBurnInstructionPlan,
    getConfidentialMintInstructionPlan,
    getPermissionedConfidentialBurnInstructionPlan,
} from '../../../src';
import {
    Client,
    createConfidentialTokenAccount,
    createDefaultSolanaClient,
    createMint,
    generateKeyPairSignerWithSol,
    sendAndConfirmInstructionPlan,
    sendAndConfirmInstructions,
} from '../../_setup';

const addressDecoder = getAddressDecoder();

type ConfidentialMintBurnMint = {
    mint: Awaited<ReturnType<typeof createMint>>;
    mintAuthority: Awaited<ReturnType<typeof generateKeyPairSignerWithSol>>;
    supplyElgamalKeypair: ElGamalKeypair;
    supplyAesKey: AeKey;
};

function getElGamalPubkeyAddress(keypair: ElGamalKeypair) {
    return addressDecoder.decode(new Uint8Array(keypair.pubkey().toBytes()));
}

function getRequiredExtension<TKind extends Extension['__kind']>(
    account: Mint | Token,
    kind: TKind,
): Extract<Extension, { __kind: TKind }> {
    if (!isSome(account.extensions)) {
        throw new Error('Account has no extensions.');
    }
    const found = account.extensions.value.find(e => e.__kind === kind);
    if (!found) {
        throw new Error(`Account is missing the ${kind} extension.`);
    }
    return found as Extract<Extension, { __kind: TKind }>;
}

function decryptAeBalance(aesKey: AeKey, bytes: ReadonlyUint8Array) {
    const ciphertext = AeCiphertext.fromBytes(new Uint8Array(bytes));
    if (!ciphertext) {
        throw new Error('Failed to parse decryptable balance.');
    }
    return aesKey.decrypt(ciphertext);
}

function decryptElGamalBalance(keypair: ElGamalKeypair, bytes: ReadonlyUint8Array) {
    const ciphertext = ElGamalCiphertext.fromBytes(new Uint8Array(bytes));
    if (!ciphertext) {
        throw new Error('Failed to parse encrypted balance.');
    }
    return keypair.secret().decrypt(ciphertext);
}

function createLocalMintAccount(input: { supplyElgamalKeypair: ElGamalKeypair; supplyAesKey: AeKey }): Mint {
    return {
        mintAuthority: none(),
        supply: 0n,
        decimals: 0,
        isInitialized: true,
        freezeAuthority: none(),
        extensions: some([
            {
                __kind: 'ConfidentialTransferMint',
                authority: none(),
                autoApproveNewAccounts: true,
                auditorElgamalPubkey: none(),
            },
            {
                __kind: 'ConfidentialMintBurn',
                confidentialSupply: new Uint8Array(64),
                decryptableSupply: input.supplyAesKey.encrypt(0n).toBytes(),
                supplyElgamalPubkey: getElGamalPubkeyAddress(input.supplyElgamalKeypair),
                pendingBurn: new Uint8Array(64),
            },
        ]),
    };
}

function createLocalTokenAccount(input: {
    mint: Awaited<ReturnType<typeof generateKeyPairSigner>>;
    owner: Awaited<ReturnType<typeof generateKeyPairSigner>>;
    elgamalKeypair: ElGamalKeypair;
    aesKey: AeKey;
    availableBalance?: bigint;
}): Token {
    const availableBalance = input.availableBalance ?? 0n;
    return {
        mint: input.mint.address,
        owner: input.owner.address,
        amount: 0n,
        delegate: none(),
        state: AccountState.Initialized,
        isNative: none(),
        delegatedAmount: 0n,
        closeAuthority: none(),
        extensions: some([
            {
                __kind: 'ConfidentialTransferAccount',
                approved: true,
                elgamalPubkey: getElGamalPubkeyAddress(input.elgamalKeypair),
                pendingBalanceLow: new Uint8Array(64),
                pendingBalanceHigh: new Uint8Array(64),
                availableBalance: input.elgamalKeypair.pubkey().encryptU64(availableBalance).toBytes(),
                decryptableAvailableBalance: input.aesKey.encrypt(availableBalance).toBytes(),
                allowConfidentialCredits: true,
                allowNonConfidentialCredits: true,
                pendingBalanceCreditCounter: 0n,
                maximumPendingBalanceCreditCounter: 0n,
                expectedPendingBalanceCreditCounter: 0n,
                actualPendingBalanceCreditCounter: 0n,
            },
        ]),
    };
}

async function createConfidentialMintBurnMint(input: {
    client: Client;
    payer: Awaited<ReturnType<typeof generateKeyPairSignerWithSol>>;
    permissionedBurnAuthority?: Awaited<ReturnType<typeof generateKeyPairSignerWithSol>>;
}): Promise<ConfidentialMintBurnMint> {
    const mintAuthority = await generateKeyPairSignerWithSol(input.client);
    const supplyElgamalKeypair = new ElGamalKeypair();
    const supplyAesKey = new AeKey();
    const confidentialTransferMintExtension = extension('ConfidentialTransferMint', {
        authority: some(mintAuthority.address),
        autoApproveNewAccounts: true,
        auditorElgamalPubkey: none(),
    });
    const confidentialMintBurnExtension = extension('ConfidentialMintBurn', {
        confidentialSupply: new Uint8Array(64),
        decryptableSupply: supplyAesKey.encrypt(0n).toBytes(),
        supplyElgamalPubkey: getElGamalPubkeyAddress(supplyElgamalKeypair),
        pendingBurn: new Uint8Array(64),
    });
    const permissionedBurnExtension = input.permissionedBurnAuthority
        ? [
              extension('PermissionedBurn', {
                  authority: some(input.permissionedBurnAuthority.address),
              }),
          ]
        : [];

    const mint = await createMint({
        client: input.client,
        payer: input.payer,
        authority: mintAuthority,
        extensions: [confidentialTransferMintExtension, confidentialMintBurnExtension, ...permissionedBurnExtension],
    });

    return { mint, mintAuthority, supplyElgamalKeypair, supplyAesKey };
}

async function mintConfidentialTokens(input: {
    client: Client;
    payer: Awaited<ReturnType<typeof generateKeyPairSignerWithSol>>;
    mint: ConfidentialMintBurnMint;
    token: Awaited<ReturnType<typeof createConfidentialTokenAccount>>;
    amount: bigint;
}) {
    const [{ data: mintAccount }, { data: tokenAccount }] = await Promise.all([
        fetchMint(input.client.rpc, input.mint.mint),
        fetchToken(input.client.rpc, input.token.token),
    ]);
    await sendAndConfirmInstructionPlan(
        input.client,
        input.payer,
        await getConfidentialMintInstructionPlan({
            payer: input.payer,
            rpc: input.client.rpc,
            token: input.token.token,
            mint: input.mint.mint,
            mintAccount,
            destinationTokenAccount: tokenAccount,
            authority: input.mint.mintAuthority,
            amount: input.amount,
            supplyElgamalKeypair: input.mint.supplyElgamalKeypair,
            supplyAesKey: input.mint.supplyAesKey,
        }),
    );
}

async function applyPendingBalance(input: {
    client: Client;
    payer: Awaited<ReturnType<typeof generateKeyPairSignerWithSol>>;
    owner: Awaited<ReturnType<typeof generateKeyPairSignerWithSol>>;
    token: Awaited<ReturnType<typeof createConfidentialTokenAccount>>;
}) {
    const { data: tokenAccount } = await fetchToken(input.client.rpc, input.token.token);
    await sendAndConfirmInstructions(input.client, input.payer, [
        getApplyConfidentialPendingBalanceInstructionFromToken({
            token: input.token.token,
            tokenAccount,
            authority: input.owner,
            elgamalSecretKey: input.token.elgamalKeypair.secret(),
            aesKey: input.token.aesKey,
        }),
    ]);
}

test('it rejects a negative confidential mint amount', async t => {
    const [payer, mintAddress, tokenAddress, owner, mintAuthority] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const supplyElgamalKeypair = new ElGamalKeypair();
    const supplyAesKey = new AeKey();
    const destinationElgamalKeypair = new ElGamalKeypair();
    const destinationAesKey = new AeKey();

    await t.throwsAsync(
        () =>
            getConfidentialMintInstructionPlan({
                payer,
                rpc: createDefaultSolanaClient().rpc,
                token: tokenAddress.address,
                mint: mintAddress.address,
                mintAccount: createLocalMintAccount({ supplyElgamalKeypair, supplyAesKey }),
                destinationTokenAccount: createLocalTokenAccount({
                    mint: mintAddress,
                    owner,
                    elgamalKeypair: destinationElgamalKeypair,
                    aesKey: destinationAesKey,
                }),
                authority: mintAuthority,
                amount: -1n,
                supplyElgamalKeypair,
                supplyAesKey,
            }),
        { message: 'Amount must be non-negative.' },
    );
});

test('it rejects a confidential mint with the wrong supply ElGamal keypair', async t => {
    const [payer, mintAddress, tokenAddress, owner, mintAuthority] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const configuredSupplyElgamalKeypair = new ElGamalKeypair();
    const inputSupplyElgamalKeypair = new ElGamalKeypair();
    const supplyAesKey = new AeKey();
    const destinationElgamalKeypair = new ElGamalKeypair();
    const destinationAesKey = new AeKey();

    await t.throwsAsync(
        () =>
            getConfidentialMintInstructionPlan({
                payer,
                rpc: createDefaultSolanaClient().rpc,
                token: tokenAddress.address,
                mint: mintAddress.address,
                mintAccount: createLocalMintAccount({
                    supplyElgamalKeypair: configuredSupplyElgamalKeypair,
                    supplyAesKey,
                }),
                destinationTokenAccount: createLocalTokenAccount({
                    mint: mintAddress,
                    owner,
                    elgamalKeypair: destinationElgamalKeypair,
                    aesKey: destinationAesKey,
                }),
                authority: mintAuthority,
                amount: 1n,
                supplyElgamalKeypair: inputSupplyElgamalKeypair,
                supplyAesKey,
            }),
        { message: 'Supply ElGamal keypair does not match mint.' },
    );
});

test('it rejects a confidential burn larger than the decryptable available balance', async t => {
    const [payer, mintAddress, tokenAddress, owner] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    const supplyElgamalKeypair = new ElGamalKeypair();
    const supplyAesKey = new AeKey();
    const sourceElgamalKeypair = new ElGamalKeypair();
    const sourceAesKey = new AeKey();

    await t.throwsAsync(
        () =>
            getConfidentialBurnInstructionPlan({
                payer,
                rpc: createDefaultSolanaClient().rpc,
                token: tokenAddress.address,
                mint: mintAddress.address,
                mintAccount: createLocalMintAccount({ supplyElgamalKeypair, supplyAesKey }),
                tokenAccount: createLocalTokenAccount({
                    mint: mintAddress,
                    owner,
                    elgamalKeypair: sourceElgamalKeypair,
                    aesKey: sourceAesKey,
                    availableBalance: 5n,
                }),
                authority: owner,
                amount: 6n,
                sourceElgamalKeypair,
                sourceAesKey,
            }),
        { message: 'Insufficient funds.' },
    );
});

test('it confidentially mints tokens into a pending balance', async t => {
    // Given a mint with confidential mint/burn enabled and a configured token account.
    const client = createDefaultSolanaClient();
    const payer = await generateKeyPairSignerWithSol(client);
    const mint = await createConfidentialMintBurnMint({ client, payer });
    const owner = await generateKeyPairSignerWithSol(client);
    const token = await createConfidentialTokenAccount({ client, payer, owner, mint: mint.mint });

    // When the mint authority confidentially mints tokens to the account.
    await mintConfidentialTokens({ client, payer, mint, token, amount: 1000n });

    // Then the mint supply is updated and the token account receives one pending credit.
    const [{ data: mintAccount }, { data: tokenAccount }] = await Promise.all([
        fetchMint(client.rpc, mint.mint),
        fetchToken(client.rpc, token.token),
    ]);
    const mintBurnExtension = getRequiredExtension(mintAccount, 'ConfidentialMintBurn');
    const confidentialAccount = getRequiredExtension(tokenAccount, 'ConfidentialTransferAccount');

    t.is(decryptAeBalance(mint.supplyAesKey, mintBurnExtension.decryptableSupply), 1000n);
    t.is(confidentialAccount.pendingBalanceCreditCounter, 1n);
});

test('it confidentially burns tokens and applies the pending burn to supply', async t => {
    // Given a confidential balance supplied by confidential minting.
    const client = createDefaultSolanaClient();
    const payer = await generateKeyPairSignerWithSol(client);
    const mint = await createConfidentialMintBurnMint({ client, payer });
    const owner = await generateKeyPairSignerWithSol(client);
    const token = await createConfidentialTokenAccount({ client, payer, owner, mint: mint.mint });
    await mintConfidentialTokens({ client, payer, mint, token, amount: 1000n });
    await applyPendingBalance({ client, payer, owner, token });

    // When the owner confidentially burns part of the available balance.
    const [{ data: mintAccount }, { data: tokenAccount }] = await Promise.all([
        fetchMint(client.rpc, mint.mint),
        fetchToken(client.rpc, token.token),
    ]);
    await sendAndConfirmInstructionPlan(
        client,
        payer,
        await getConfidentialBurnInstructionPlan({
            payer,
            rpc: client.rpc,
            token: token.token,
            mint: mint.mint,
            mintAccount,
            tokenAccount,
            authority: owner,
            amount: 400n,
            sourceElgamalKeypair: token.elgamalKeypair,
            sourceAesKey: token.aesKey,
        }),
    );

    // Then the source balance decreases and the mint records a pending burn.
    const [{ data: mintAfterBurn }, { data: tokenAfterBurn }] = await Promise.all([
        fetchMint(client.rpc, mint.mint),
        fetchToken(client.rpc, token.token),
    ]);
    const tokenExtensionAfterBurn = getRequiredExtension(tokenAfterBurn, 'ConfidentialTransferAccount');
    const mintBurnExtensionAfterBurn = getRequiredExtension(mintAfterBurn, 'ConfidentialMintBurn');

    t.is(decryptAeBalance(token.aesKey, tokenExtensionAfterBurn.decryptableAvailableBalance), 600n);
    t.is(decryptElGamalBalance(mint.supplyElgamalKeypair, mintBurnExtensionAfterBurn.pendingBurn), 400n);

    // And applying the pending burn updates decryptable supply.
    await sendAndConfirmInstructionPlan(
        client,
        payer,
        getApplyConfidentialPendingBurnInstructionPlan({
            mint: mint.mint,
            mintAccount: mintAfterBurn,
            authority: mint.mintAuthority,
            supplyElgamalSecretKey: mint.supplyElgamalKeypair.secret(),
            supplyAesKey: mint.supplyAesKey,
        }),
    );
    const { data: mintAfterApply } = await fetchMint(client.rpc, mint.mint);
    const mintBurnExtensionAfterApply = getRequiredExtension(mintAfterApply, 'ConfidentialMintBurn');
    t.is(decryptAeBalance(mint.supplyAesKey, mintBurnExtensionAfterApply.decryptableSupply), 600n);
    t.deepEqual(mintBurnExtensionAfterApply.pendingBurn, new Uint8Array(64));
});

test('it confidentially burns with a permissioned burn authority', async t => {
    // Given a mint with confidential mint/burn and permissioned burn enabled.
    const client = createDefaultSolanaClient();
    const payer = await generateKeyPairSignerWithSol(client);
    const permissionedBurnAuthority = await generateKeyPairSignerWithSol(client);
    const mint = await createConfidentialMintBurnMint({ client, payer, permissionedBurnAuthority });
    const owner = await generateKeyPairSignerWithSol(client);
    const token = await createConfidentialTokenAccount({ client, payer, owner, mint: mint.mint });
    await mintConfidentialTokens({ client, payer, mint, token, amount: 1000n });
    await applyPendingBalance({ client, payer, owner, token });

    // When the burn includes the configured permissioned burn authority.
    const [{ data: mintAccount }, { data: tokenAccount }] = await Promise.all([
        fetchMint(client.rpc, mint.mint),
        fetchToken(client.rpc, token.token),
    ]);
    await sendAndConfirmInstructionPlan(
        client,
        payer,
        await getPermissionedConfidentialBurnInstructionPlan({
            payer,
            rpc: client.rpc,
            token: token.token,
            mint: mint.mint,
            mintAccount,
            tokenAccount,
            permissionedBurnAuthority,
            authority: owner,
            amount: 250n,
            sourceElgamalKeypair: token.elgamalKeypair,
            sourceAesKey: token.aesKey,
        }),
    );

    // Then the source balance decreases.
    const { data: tokenAfterBurn } = await fetchToken(client.rpc, token.token);
    const tokenExtensionAfterBurn = getRequiredExtension(tokenAfterBurn, 'ConfidentialTransferAccount');
    t.is(decryptAeBalance(token.aesKey, tokenExtensionAfterBurn.decryptableAvailableBalance), 750n);
});
