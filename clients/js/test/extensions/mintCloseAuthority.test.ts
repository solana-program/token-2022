import { expect, it } from 'vitest';
import { Account, address, generateKeyPairSigner, none, some } from '@solana/kit';
import { Mint, extension, fetchMint, getInitializeMintCloseAuthorityInstruction } from '../../src';
import {
    createDefaultSolanaClient,
    generateKeyPairSignerWithSol,
    getCreateMintInstructions,
    sendAndConfirmInstructions,
} from '../_setup';

it('initializes a mint account with a close authority', async () => {
    // Given an authority and a mint account.
    const client = createDefaultSolanaClient();
    const [authority, mint] = await Promise.all([generateKeyPairSignerWithSol(client), generateKeyPairSigner()]);

    // And a mint close authority extension.
    const mintCloseAuthorityExtension = extension('MintCloseAuthority', {
        closeAuthority: address('HHS1XymmkBpYAkg3XTbZLxgHa5n11PAWUCWdiVtRmzzS'),
    });

    // When we create and initialize a mint account with this extension.
    const [createMintInstruction, initMintInstruction] = await getCreateMintInstructions({
        authority: authority.address,
        client,
        decimals: 2,
        extensions: [mintCloseAuthorityExtension],
        mint,
        payer: authority,
    });
    await sendAndConfirmInstructions(client, authority, [
        createMintInstruction,
        getInitializeMintCloseAuthorityInstruction({
            mint: mint.address,
            closeAuthority: mintCloseAuthorityExtension.closeAuthority,
        }),
        initMintInstruction,
    ]);

    // Then we expect the mint account to exist and have the following data.
    const mintAccount = await fetchMint(client.rpc, mint.address);
    expect(mintAccount).toMatchObject(<Account<Mint>>{
        address: mint.address,
        data: {
            mintAuthority: some(authority.address),
            supply: 0n,
            decimals: 2,
            isInitialized: true,
            freezeAuthority: none(),
            extensions: some([
                {
                    __kind: 'MintCloseAuthority',
                    closeAuthority: address('HHS1XymmkBpYAkg3XTbZLxgHa5n11PAWUCWdiVtRmzzS'),
                },
            ]),
        },
    });
});
