import { expect, it } from 'vitest';
import { Account, generateKeyPairSigner, some } from '@solana/kit';
import { Mint, extension, fetchMint, getInitializeNonTransferableMintInstruction } from '../../../src';
import { createTestClient, generateKeyPairSignerWithSol, getCreateMintInstructions } from '../../_setup';

it('initializes a non-transferable mint', async () => {
    // Given an authority and a mint account.
    const client = await createTestClient();
    const [authority, mint] = await Promise.all([generateKeyPairSignerWithSol(client), generateKeyPairSigner()]);

    // When we create and initialize a mint account as non-transferable
    const [createMintInstruction, initMintInstruction] = await getCreateMintInstructions({
        authority: authority.address,
        client,
        extensions: [extension('NonTransferable', {})],
        mint,
        payer: authority,
    });

    await client.sendTransaction([
        createMintInstruction,
        getInitializeNonTransferableMintInstruction({
            mint: mint.address,
        }),
        initMintInstruction,
    ]);

    // Then we expect the mint to be initialized with the non-transferable extension
    const mintAccount = await fetchMint(client.rpc, mint.address);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
        data: {
            mintAuthority: some(authority.address),
            isInitialized: true,
            extensions: some([extension('NonTransferable', {})]),
        },
    });
});
