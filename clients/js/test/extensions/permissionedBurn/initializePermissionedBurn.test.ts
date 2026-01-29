import { Account, generateKeyPairSigner, some } from '@solana/kit';
import test from 'ava';
import { Mint, extension, fetchMint, getInitializePermissionedBurnInstruction } from '../../../src';
import {
    createDefaultSolanaClient,
    generateKeyPairSignerWithSol,
    getCreateMintInstructions,
    sendAndConfirmInstructions,
} from '../../_setup';

test('it initializes a mint with permissioned burn', async t => {
    // Given a fresh client and signers
    const client = createDefaultSolanaClient();
    const [authority, mint, permissionedBurnAuthority] = await Promise.all([
        generateKeyPairSignerWithSol(client),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a permissioned burn extension
    const permissionedBurnExtension = extension('PermissionedBurn', {
        authority: some(permissionedBurnAuthority.address),
    });

    // When we create and initialize a mint account with this extension
    const [createMintInstruction, initMintInstruction] = await getCreateMintInstructions({
        authority: authority.address,
        client,
        extensions: [permissionedBurnExtension],
        mint,
        payer: authority,
    });

    await sendAndConfirmInstructions(client, authority, [
        createMintInstruction,
        getInitializePermissionedBurnInstruction({
            mint: mint.address,
            authority: permissionedBurnAuthority.address,
        }),
        initMintInstruction,
    ]);

    // Then we expect the mint account to exist with the permissioned burn config
    const mintAccount = await fetchMint(client.rpc, mint.address);
    t.like(mintAccount, <Account<Mint>>{
        address: mint.address,
        data: {
            mintAuthority: some(authority.address),
            isInitialized: true,
            extensions: some([permissionedBurnExtension]),
        },
    });
});
