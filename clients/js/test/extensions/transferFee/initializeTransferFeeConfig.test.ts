import { Account, address, generateKeyPairSigner, none, some } from '@solana/kit';
import { expect, it } from 'vitest';

import { Mint, extension, fetchMint } from '../../../src';
import { createTestClient } from '../../_setup';

it('initializes a mint account with transfer fee configurations', async () => {
    // Given an authority and a mint account.
    const client = await createTestClient();
    const [authority, mint] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);

    // And a transfer fee config extension.
    const transferFees = {
        epoch: 0n,
        maximumFee: 1_000_000_000n,
        transferFeeBasisPoints: 150, // 1.5%
    };
    const transferFeeConfigExtension = extension('TransferFeeConfig', {
        transferFeeConfigAuthority: address('6sPR6MzvjMMP5LSZzEtTe4ZBVX9rhBmtM1dmfFtkNTbW'),
        withdrawWithheldAuthority: address('BTNEPmmWuj7Sg4Fo5i1FC5eiV2Aj4jiv9boarvE5XeaX'),
        withheldAmount: 0n,
        newerTransferFee: transferFees,
        // Used for transitioning configs. Starts by being the same as newerTransferFee.
        olderTransferFee: transferFees,
    });

    // When we create and initialize a mint account with this extension.
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            decimals: 2,
            mintAuthority: authority,
            extensions: [transferFeeConfigExtension],
        })
        .sendTransaction();

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
            extensions: some([transferFeeConfigExtension]),
        },
    });
});
