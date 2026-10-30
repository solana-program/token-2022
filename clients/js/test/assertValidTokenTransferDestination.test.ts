import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import {
    address,
    generateKeyPairSigner,
    getProgramDerivedAddress,
    lamports,
    type Address,
    type HasAddress,
} from '@solana/kit';
import { expect, it, vi } from 'vitest';

import {
    assertValidTokenTransferDestination,
    ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    AuthorityType,
    extension,
    type ExtensionArgs,
    findAssociatedTokenPda,
    getMultisigSize,
    getTokenSize,
    InvalidTokenTransferDestinationError,
    TOKEN_2022_PROGRAM_ADDRESS,
    TOKEN_PROGRAM_ADDRESS,
} from '../src';
import { createTestClient, type LiteSvmClient as TestClient } from './_setup';

const OTHER_PROGRAM_ADDRESS = address('BPFLoaderUpgradeab1e11111111111111111111111');

class AddressWrapper implements HasAddress {
    constructor(readonly address: Address) {}
}

const createTestMint = async (
    client: TestClient,
    {
        extensions,
        freezeAuthority,
        tokenProgram,
    }: { extensions?: ExtensionArgs[]; freezeAuthority?: Address; tokenProgram?: Address } = {},
): Promise<Address> => {
    const [mint, mintAuthority] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    await client.token2022.instructions
        .createMint({ newMint: mint, decimals: 2, mintAuthority, freezeAuthority, extensions }, { tokenProgram })
        .sendTransaction();
    return mint.address;
};

const createToken = async (client: TestClient, mint: Address, owner: Address): Promise<Address> => {
    const newToken = await generateKeyPairSigner();
    await client.token2022.instructions.createToken({ newToken, mint, owner }).sendTransaction();
    return newToken.address;
};

const createFundedAddress = async (client: TestClient): Promise<Address> => {
    const recipient = (await generateKeyPairSigner()).address;
    await client.airdrop(recipient, lamports(1_000_000_000n));
    return recipient;
};

const createForeignOwnedAddress = async (client: TestClient): Promise<Address> => {
    const account = await generateKeyPairSigner();
    await client.airdrop(account.address, lamports(1_000_000_000n));
    await client.system.instructions.assign({ account, programAddress: OTHER_PROGRAM_ADDRESS }).sendTransaction();
    return account.address;
};

const deriveOffCurveAddress = async (): Promise<Address> => {
    const [pda] = await getProgramDerivedAddress({
        programAddress: SYSTEM_PROGRAM_ADDRESS,
        seeds: ['guarded-transfer'],
    });
    return pda;
};

const findAta = async (
    owner: Address,
    mint: Address,
    tokenProgram: Address = TOKEN_2022_PROGRAM_ADDRESS,
): Promise<Address> => {
    const [ata] = await findAssociatedTokenPda({ owner, mint, tokenProgram });
    return ata;
};

const createAta = async (
    client: TestClient,
    owner: Address,
    mint: Address,
    tokenProgram: Address = TOKEN_2022_PROGRAM_ADDRESS,
): Promise<Address> => {
    const payer = await generateKeyPairSigner();
    await client.airdrop(payer.address, lamports(1_000_000_000n));
    await client.associatedToken.instructions
        .createAssociatedToken({ payer, owner, mint, tokenProgram })
        .sendTransaction();
    return await findAta(owner, mint, tokenProgram);
};

const createUninitializedTokenProgramAccount = async (client: TestClient, space: number): Promise<Address> => {
    const newAccount = await generateKeyPairSigner();
    const rent = await client.rpc.getMinimumBalanceForRentExemption(BigInt(space)).send();
    await client.system.instructions
        .createAccount({ newAccount, lamports: rent, space, programAddress: TOKEN_2022_PROGRAM_ADDRESS })
        .sendTransaction();
    return newAccount.address;
};

const nonAta = { allowNonAssociatedTokenAccount: true };

it('accepts the existing associated token account of a System-Program-owned recipient', async () => {
    // Given a funded recipient with an associated token account for the mint.
    const client = await createTestClient();
    const [mint, recipient] = await Promise.all([createTestMint(client), createFundedAddress(client)]);
    const destination = await createAta(client, recipient, mint);

    // Then it is a valid destination.
    await expect(
        assertValidTokenTransferDestination(client.rpc, { mint, destination, recipient }),
    ).resolves.toBeUndefined();
});

it('accepts an associated token account that does not exist yet', async () => {
    // Given a funded recipient without an associated token account for the mint.
    const client = await createTestClient();
    const [mint, recipient] = await Promise.all([createTestMint(client), createFundedAddress(client)]);
    const destination = await findAta(recipient, mint);

    // Then it is a valid destination.
    await expect(
        assertValidTokenTransferDestination(client.rpc, { mint, destination, recipient }),
    ).resolves.toBeUndefined();
});

it('rejects a missing associated token account when allowMissingAssociatedTokenAccount is false', async () => {
    // Given a funded recipient without an associated token account for the mint.
    const client = await createTestClient();
    const [mint, recipient] = await Promise.all([createTestMint(client), createFundedAddress(client)]);
    const destination = await findAta(recipient, mint);

    // Then it is rejected as missing when missing associated token accounts are disallowed.
    await expect(
        assertValidTokenTransferDestination(
            client.rpc,
            { mint, destination, recipient },
            { allowMissingAssociatedTokenAccount: false },
        ),
    ).rejects.toMatchObject({
        message: expect.stringContaining('allowMissingAssociatedTokenAccount'),
        destination,
        details: { reason: 'missing-token-account' },
    });
});

it('accepts an existing associated token account when allowMissingAssociatedTokenAccount is false', async () => {
    // Given a funded recipient with an associated token account for the mint.
    const client = await createTestClient();
    const [mint, recipient] = await Promise.all([createTestMint(client), createFundedAddress(client)]);
    const destination = await createAta(client, recipient, mint);

    // Then it is valid when missing associated token accounts are disallowed.
    await expect(
        assertValidTokenTransferDestination(
            client.rpc,
            { mint, destination, recipient },
            { allowMissingAssociatedTokenAccount: false },
        ),
    ).resolves.toBeUndefined();
});

it('accepts an existing associated token account of an unfunded recipient when allowMissingAssociatedTokenAccount is false', async () => {
    // Given an on-curve recipient with no account on-chain but an associated token account for the mint.
    const client = await createTestClient();
    const [mint, { address: recipient }] = await Promise.all([createTestMint(client), generateKeyPairSigner()]);
    const destination = await createAta(client, recipient, mint);

    // Then it is valid when unfunded recipients are allowed and missing associated token accounts are not.
    await expect(
        assertValidTokenTransferDestination(
            client.rpc,
            { mint, destination, recipient },
            { allowMissingAssociatedTokenAccount: false, allowUnfundedRecipient: true },
        ),
    ).resolves.toBeUndefined();
});

it('rejects a recipient owned by another program', async () => {
    // Given a recipient owned by another program.
    const client = await createTestClient();
    const [mint, recipient] = await Promise.all([createTestMint(client), createForeignOwnedAddress(client)]);
    const destination = await findAta(recipient, mint);

    // Then it is rejected as owned by an unexpected program.
    const promise = assertValidTokenTransferDestination(client.rpc, { mint, destination, recipient });
    await expect(promise).rejects.toBeInstanceOf(InvalidTokenTransferDestinationError);
    await expect(promise).rejects.toMatchObject({
        message: expect.stringContaining(`owned by program ${OTHER_PROGRAM_ADDRESS}`),
        destination,
        recipient,
        details: { reason: 'unexpected-owner', owner: OTHER_PROGRAM_ADDRESS },
    });
});

it('rejects a token account passed as the recipient as unexpected-owner before off-curve', async () => {
    // Given an associated token account, itself off-curve, used as the recipient.
    const client = await createTestClient();
    const [mint, wallet] = await Promise.all([createTestMint(client), createFundedAddress(client)]);
    const recipient = await createAta(client, wallet, mint);
    const destination = await findAta(recipient, mint);

    // Then the owner check fails first, even when off-curve recipients are disallowed.
    await expect(
        assertValidTokenTransferDestination(client.rpc, { mint, destination, recipient }, { allowOffCurve: false }),
    ).rejects.toMatchObject({ details: { reason: 'unexpected-owner', owner: TOKEN_2022_PROGRAM_ADDRESS } });
});

it('accepts a recipient owned by the program given in programOwner', async () => {
    // Given a recipient owned by another program.
    const client = await createTestClient();
    const [mint, recipient] = await Promise.all([createTestMint(client), createForeignOwnedAddress(client)]);
    const destination = await findAta(recipient, mint);

    // Then it is valid when that program is the expected owner.
    await expect(
        assertValidTokenTransferDestination(
            client.rpc,
            { mint, destination, recipient },
            { programOwner: OTHER_PROGRAM_ADDRESS },
        ),
    ).resolves.toBeUndefined();
});

it('rejects an unfunded recipient by default', async () => {
    // Given an on-curve recipient with no account on-chain.
    const client = await createTestClient();
    const [mint, { address: recipient }] = await Promise.all([createTestMint(client), generateKeyPairSigner()]);
    const destination = await findAta(recipient, mint);

    // Then it is rejected as unfunded.
    await expect(
        assertValidTokenTransferDestination(client.rpc, { mint, destination, recipient }),
    ).rejects.toMatchObject({ recipient, details: { reason: 'unfunded-recipient' } });
});

it('accepts an unfunded recipient when allowUnfundedRecipient is set', async () => {
    // Given an on-curve recipient with no account on-chain.
    const client = await createTestClient();
    const [mint, { address: recipient }] = await Promise.all([createTestMint(client), generateKeyPairSigner()]);
    const destination = await findAta(recipient, mint);

    // Then it is valid when unfunded recipients are allowed.
    await expect(
        assertValidTokenTransferDestination(
            client.rpc,
            { mint, destination, recipient },
            { allowUnfundedRecipient: true },
        ),
    ).resolves.toBeUndefined();
});

it('accepts an off-curve recipient unless allowOffCurve is false', async () => {
    // Given a funded off-curve recipient with an associated token account for the mint.
    const client = await createTestClient();
    const [mint, recipient] = await Promise.all([createTestMint(client), deriveOffCurveAddress()]);
    await client.airdrop(recipient, lamports(1_000_000_000n));
    const destination = await createAta(client, recipient, mint);
    const input = { mint, destination, recipient };

    // Then it is valid by default and rejected when off-curve recipients are disallowed.
    await expect(assertValidTokenTransferDestination(client.rpc, input)).resolves.toBeUndefined();
    await expect(
        assertValidTokenTransferDestination(client.rpc, input, { allowOffCurve: false }),
    ).rejects.toMatchObject({ recipient, details: { reason: 'off-curve' } });
});

it('rejects an unfunded off-curve recipient as off-curve when allowOffCurve is false', async () => {
    // Given an off-curve recipient with no account on-chain.
    const client = await createTestClient();
    const [mint, recipient] = await Promise.all([createTestMint(client), deriveOffCurveAddress()]);
    const destination = await findAta(recipient, mint);
    const input = { mint, destination, recipient };

    // Then it is valid when unfunded recipients are allowed, unless off-curve recipients are disallowed.
    await expect(
        assertValidTokenTransferDestination(client.rpc, input, { allowUnfundedRecipient: true }),
    ).resolves.toBeUndefined();
    await expect(
        assertValidTokenTransferDestination(client.rpc, input, {
            allowOffCurve: false,
            allowUnfundedRecipient: true,
        }),
    ).rejects.toMatchObject({ details: { reason: 'off-curve' } });
});

it('rejects a destination that is the recipient associated token account for another mint', async () => {
    // Given a recipient and its associated token account for another mint.
    const client = await createTestClient();
    const [mint, otherMint, recipient] = await Promise.all([
        createTestMint(client),
        createTestMint(client),
        createFundedAddress(client),
    ]);
    const [destination, expectedDestination] = await Promise.all([
        createAta(client, recipient, otherMint),
        findAta(recipient, mint),
    ]);

    // Then it is rejected as not the expected associated token account.
    await expect(
        assertValidTokenTransferDestination(client.rpc, { mint, destination, recipient }),
    ).rejects.toMatchObject({
        message: expect.stringContaining(`(ATA is: ${expectedDestination})`),
        destination,
        recipient,
        details: { reason: 'ata-mismatch' },
    });
});

it('rejects a non-associated token account owned by the recipient', async () => {
    // Given a recipient and a non-associated token account it owns for the mint.
    const client = await createTestClient();
    const [mint, recipient] = await Promise.all([createTestMint(client), createFundedAddress(client)]);
    const destination = await createToken(client, mint, recipient);

    // Then it is rejected as not the expected associated token account.
    await expect(
        assertValidTokenTransferDestination(client.rpc, { mint, destination, recipient }),
    ).rejects.toMatchObject({ details: { reason: 'ata-mismatch' } });
});

it('accepts a non-associated token account owned by the recipient when allowNonAssociatedTokenAccount is set', async () => {
    // Given a recipient and a non-associated token account it owns for the mint.
    const client = await createTestClient();
    const [mint, recipient] = await Promise.all([createTestMint(client), createFundedAddress(client)]);
    const destination = await createToken(client, mint, recipient);

    // Then it is valid when non-associated token accounts are allowed.
    await expect(
        assertValidTokenTransferDestination(client.rpc, { mint, destination, recipient }, nonAta),
    ).resolves.toBeUndefined();
});

it('still accepts associated token accounts when allowNonAssociatedTokenAccount is set', async () => {
    // Given a funded recipient without an associated token account for the mint.
    const client = await createTestClient();
    const [mint, recipient] = await Promise.all([createTestMint(client), createFundedAddress(client)]);
    const destination = await findAta(recipient, mint);

    // Then the missing associated token account is still valid.
    await expect(
        assertValidTokenTransferDestination(client.rpc, { mint, destination, recipient }, nonAta),
    ).resolves.toBeUndefined();
});

it('rejects a missing non-associated token account', async () => {
    // Given a recipient and an address with no account on-chain.
    const client = await createTestClient();
    const [mint, recipient, { address: destination }] = await Promise.all([
        createTestMint(client),
        createFundedAddress(client),
        generateKeyPairSigner(),
    ]);

    // Then it is rejected as missing.
    await expect(
        assertValidTokenTransferDestination(client.rpc, { mint, destination, recipient }, nonAta),
    ).rejects.toMatchObject({ destination, details: { reason: 'missing-token-account' } });
});

it('rejects a non-associated destination that is not a token account', async () => {
    // Given a recipient, a wallet, a mint, a mint with extensions, a multisig-sized account and an uninitialized
    // token account.
    const client = await createTestClient();
    const [mint, recipient, wallet, mintWithExtensions, multisig, uninitialized] = await Promise.all([
        createTestMint(client),
        createFundedAddress(client),
        createFundedAddress(client),
        createTestMint(client, {
            extensions: [extension('MintCloseAuthority', { closeAuthority: OTHER_PROGRAM_ADDRESS })],
        }),
        createUninitializedTokenProgramAccount(client, getMultisigSize()),
        createUninitializedTokenProgramAccount(client, getTokenSize()),
    ]);

    // Then each is rejected as not a token account.
    for (const destination of [wallet, mint, mintWithExtensions, multisig, uninitialized]) {
        await expect(
            assertValidTokenTransferDestination(client.rpc, { mint, destination, recipient }, nonAta),
        ).rejects.toMatchObject({ destination, details: { reason: 'not-token-account' } });
    }
});

it('rejects a non-associated token account for another mint', async () => {
    // Given a recipient and a token account it owns for another mint.
    const client = await createTestClient();
    const [mint, otherMint, recipient] = await Promise.all([
        createTestMint(client),
        createTestMint(client),
        createFundedAddress(client),
    ]);
    const destination = await createToken(client, otherMint, recipient);

    // Then it is rejected as a mint mismatch.
    await expect(
        assertValidTokenTransferDestination(client.rpc, { mint, destination, recipient }, nonAta),
    ).rejects.toMatchObject({ destination, details: { reason: 'mint-mismatch', mint: otherMint } });
});

it('rejects a non-associated token account owned by someone else', async () => {
    // Given a recipient and a token account for the mint owned by another wallet.
    const client = await createTestClient();
    const [mint, recipient, otherOwner] = await Promise.all([
        createTestMint(client),
        createFundedAddress(client),
        createFundedAddress(client),
    ]);
    const destination = await createToken(client, mint, otherOwner);

    // Then it is rejected as owned by someone other than the recipient.
    await expect(
        assertValidTokenTransferDestination(client.rpc, { mint, destination, recipient }, nonAta),
    ).rejects.toMatchObject({ destination, details: { reason: 'token-owner-mismatch', tokenOwner: otherOwner } });
});

it('rejects a legacy Token associated token account whose owner was reassigned', async () => {
    // Given a recipient whose legacy Token associated token account was reassigned to another owner.
    const client = await createTestClient();
    const [mint, recipient, newOwner] = await Promise.all([
        createTestMint(client, { tokenProgram: TOKEN_PROGRAM_ADDRESS }),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);
    await client.airdrop(recipient.address, lamports(1_000_000_000n));
    const destination = await createAta(client, recipient.address, mint, TOKEN_PROGRAM_ADDRESS);
    await client.token2022.instructions
        .setAuthority(
            {
                owned: destination,
                owner: recipient,
                authorityType: AuthorityType.AccountOwner,
                newAuthority: newOwner.address,
            },
            { programAddress: TOKEN_PROGRAM_ADDRESS },
        )
        .sendTransaction();

    // Then it is rejected as owned by someone other than the recipient.
    await expect(
        assertValidTokenTransferDestination(
            client.rpc,
            { mint, destination, recipient: recipient.address },
            { tokenProgram: TOKEN_PROGRAM_ADDRESS },
        ),
    ).rejects.toMatchObject({
        destination,
        recipient: recipient.address,
        details: { reason: 'token-owner-mismatch', tokenOwner: newOwner.address },
    });
});

it('rejects a frozen associated token account', async () => {
    // Given a funded recipient whose associated token account was frozen by the mint's freeze authority.
    const client = await createTestClient();
    const freezeAuthority = await generateKeyPairSigner();
    const [mint, recipient] = await Promise.all([
        createTestMint(client, { freezeAuthority: freezeAuthority.address }),
        createFundedAddress(client),
    ]);
    const destination = await createAta(client, recipient, mint);
    await client.token2022.instructions
        .freezeAccount({ account: destination, mint, owner: freezeAuthority })
        .sendTransaction();

    // Then it is rejected as frozen.
    await expect(
        assertValidTokenTransferDestination(client.rpc, { mint, destination, recipient }),
    ).rejects.toMatchObject({ destination, recipient, details: { reason: 'frozen' } });
});

it('accepts signer, HasAddress and ProgramDerivedAddress inputs', async () => {
    // Given a mint held in an `AddressWrapper` and a funded recipient held as a signer.
    const client = await createTestClient();
    const mint = new AddressWrapper(await createTestMint(client));
    const recipient = await generateKeyPairSigner();
    await client.airdrop(recipient.address, lamports(1_000_000_000n));
    const destination = await findAssociatedTokenPda({
        owner: recipient.address,
        mint: mint.address,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });

    // Then it is valid with the destination held as a `[address, bump]` tuple.
    await expect(
        assertValidTokenTransferDestination(client.rpc, { mint, destination, recipient }),
    ).resolves.toBeUndefined();
});

it('accepts a legacy Token associated token account when tokenProgram is set', async () => {
    // Given a funded recipient with a legacy Token associated token account.
    const client = await createTestClient();
    const [mint, recipient] = await Promise.all([
        createTestMint(client, { tokenProgram: TOKEN_PROGRAM_ADDRESS }),
        createFundedAddress(client),
    ]);
    const destination = await createAta(client, recipient, mint, TOKEN_PROGRAM_ADDRESS);
    const input = { mint, destination, recipient };

    // Then it is valid for the Token program and not the associated token account of the Token-2022 program.
    await expect(
        assertValidTokenTransferDestination(client.rpc, input, {
            tokenProgram: new AddressWrapper(TOKEN_PROGRAM_ADDRESS),
        }),
    ).resolves.toBeUndefined();
    await expect(assertValidTokenTransferDestination(client.rpc, input)).rejects.toMatchObject({
        details: { reason: 'ata-mismatch' },
    });
});

it('derives the associated token account from the associatedTokenProgram', async () => {
    // Given a funded recipient with an associated token account for the mint.
    const client = await createTestClient();
    const [mint, recipient] = await Promise.all([createTestMint(client), createFundedAddress(client)]);
    const destination = await createAta(client, recipient, mint);

    // Then it is not the associated token account derived from another associated token program.
    await expect(
        assertValidTokenTransferDestination(
            client.rpc,
            { mint, destination, recipient },
            { associatedTokenProgram: new AddressWrapper(OTHER_PROGRAM_ADDRESS) },
        ),
    ).rejects.toMatchObject({ details: { reason: 'ata-mismatch' } });
});

it('does not forward guard options to getAccountInfo', async () => {
    // Given a funded recipient and an RPC that records getAccountInfo calls.
    const client = await createTestClient();
    const [mint, recipient] = await Promise.all([createTestMint(client), createFundedAddress(client)]);
    const destination = await findAta(recipient, mint);
    const getAccountInfo = vi.fn(client.rpc.getAccountInfo);
    const rpc = { getAccountInfo } as unknown as typeof client.rpc;

    // When we validate it with guard options and a commitment.
    await assertValidTokenTransferDestination(
        rpc,
        { mint, destination, recipient },
        {
            allowMissingAssociatedTokenAccount: true,
            allowNonAssociatedTokenAccount: true,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
            allowOffCurve: true,
            allowUnfundedRecipient: true,
            commitment: 'confirmed',
            programOwner: SYSTEM_PROGRAM_ADDRESS,
            tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        },
    );

    // Then only the fetch options reach the RPC, for both the recipient and the destination.
    expect(getAccountInfo).toHaveBeenCalledWith(recipient, { commitment: 'confirmed', encoding: 'base64' });
    expect(getAccountInfo).toHaveBeenCalledWith(destination, { commitment: 'confirmed', encoding: 'base64' });
});
