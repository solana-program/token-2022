import { Account, address, generateKeyPairSigner, sequentialInstructionPlan, some } from '@solana/kit';
import { expect, it } from 'vitest';

import { Token, extension, fetchToken, getCreateTokenInstructionPlan, getMintToInstruction } from '../../../src';
import { createTestClient } from '../../_setup';

it('transfers tokens with pre-configured fees', async () => {
    // Given some signer accounts.
    const client = await createTestClient();
    const [authority, ownerA, tokenA, ownerB, tokenB, mint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    // And a mint account initialized with transfer fee configurations.
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
    await client.token2022.instructions
        .createMint({
            newMint: mint,
            decimals: 2,
            mintAuthority: authority,
            extensions: [transferFeeConfigExtension],
        })
        .sendTransaction();

    // And two token accounts with 10.00 and 0.00 tokens respectively.
    const transferFeeAmount = extension('TransferFeeAmount', {
        withheldAmount: 0n,
    });
    const createTokenAPlan = await getCreateTokenInstructionPlan(client, {
        payer: client.payer,
        newToken: tokenA,
        mint: mint.address,
        owner: ownerA.address,
        extensions: [transferFeeAmount],
    });
    const createTokenBPlan = await getCreateTokenInstructionPlan(client, {
        payer: client.payer,
        newToken: tokenB,
        mint: mint.address,
        owner: ownerB.address,
        extensions: [transferFeeAmount],
    });
    await client.sendTransaction(
        sequentialInstructionPlan([
            createTokenAPlan,
            createTokenBPlan,
            getMintToInstruction({
                mint: mint.address,
                token: tokenA.address,
                mintAuthority: authority,
                amount: 1000n,
            }),
        ]),
    );

    // When we transfer 2.00 tokens from owner A to owner B with fees.
    await client.token2022.instructions
        .transferCheckedWithFee({
            source: tokenA.address,
            mint: mint.address,
            destination: tokenB.address,
            authority: ownerA,
            amount: 200n,
            decimals: 2,
            fee: 3n, // 1.5% of 2.00 is 0.03.
        })
        .sendTransaction();

    // Then we expect token A to have 8.00 tokens and no fees withheld.
    const tokenAccountA = await fetchToken(client.rpc, tokenA.address);
    expect(tokenAccountA).toMatchObject(<Account<Token>>{
        address: tokenA.address,
        data: {
            mint: mint.address,
            owner: ownerA.address,
            amount: 800n,
            extensions: some([extension('TransferFeeAmount', { withheldAmount: 0n })]),
        },
    });

    // And token B to have 1.97 tokens and 0.03 fees withheld.
    const tokenAccountB = await fetchToken(client.rpc, tokenB.address);
    expect(tokenAccountB).toMatchObject(<Account<Token>>{
        address: tokenB.address,
        data: {
            mint: mint.address,
            owner: ownerB.address,
            amount: 197n,
            extensions: some([extension('TransferFeeAmount', { withheldAmount: 3n })]),
        },
    });
});
