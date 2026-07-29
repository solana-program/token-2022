import { generateKeyPairSigner } from '@solana/kit';
import { expect, it } from 'vitest';

import { fetchToken, Token } from '../../../src';
import { createTestClient, createTokenWithAmount } from '../../_setup';

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
