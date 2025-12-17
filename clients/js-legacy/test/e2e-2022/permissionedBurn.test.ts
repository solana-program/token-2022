import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
use(chaiAsPromised);

import type { Connection, PublicKey, Signer } from '@solana/web3.js';
import { Keypair, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import {
    ExtensionType,
    burn,
    createAccount,
    createInitializeMintInstruction,
    createPermissionedBurnCheckedInstruction,
    createInitializePermissionedBurnInstruction,
    getMint,
    getMintLen,
    getPermissionedBurn,
    mintTo,
} from '../../src';
import { TEST_PROGRAM_ID, getConnection, newAccountWithLamports } from '../common';

const TEST_TOKEN_DECIMALS = 0;
const EXTENSIONS = [ExtensionType.PermissionedBurn];

describe('permissioned burn', () => {
    let connection: Connection;
    let payer: Signer;
    let mint: PublicKey;
    let mintAuthority: Keypair;
    let permissionedAuthority: Keypair;
    before(async () => {
        connection = await getConnection();
        payer = await newAccountWithLamports(connection, 1_000_000_000);
        mintAuthority = Keypair.generate();
        permissionedAuthority = Keypair.generate();
    });

    beforeEach(async () => {
        const mintKeypair = Keypair.generate();
        mint = mintKeypair.publicKey;
        const mintLen = getMintLen(EXTENSIONS);
        const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);
        const transaction = new Transaction().add(
            SystemProgram.createAccount({
                fromPubkey: payer.publicKey,
                newAccountPubkey: mint,
                space: mintLen,
                lamports,
                programId: TEST_PROGRAM_ID,
            }),
            createInitializePermissionedBurnInstruction(mint, permissionedAuthority.publicKey, TEST_PROGRAM_ID),
            createInitializeMintInstruction(mint, TEST_TOKEN_DECIMALS, mintAuthority.publicKey, null, TEST_PROGRAM_ID),
        );

        await sendAndConfirmTransaction(connection, transaction, [payer, mintKeypair]);
    });

    it('initializes config', async () => {
        const mintInfo = await getMint(connection, mint, undefined, TEST_PROGRAM_ID);
        const permissionedConfig = getPermissionedBurn(mintInfo);
        expect(permissionedConfig).to.not.equal(null);
        if (permissionedConfig !== null) {
            expect(permissionedConfig.authority).to.eql(permissionedAuthority.publicKey);
        }
    });

    it('enforces permissioned authority for burn', async () => {
        const owner = Keypair.generate();
        const account = await createAccount(
            connection,
            payer,
            mint,
            owner.publicKey,
            undefined,
            undefined,
            TEST_PROGRAM_ID,
        );
        await mintTo(connection, payer, mint, account, mintAuthority, 2, [], undefined, TEST_PROGRAM_ID);

        await expect(
            burn(connection, payer, account, mint, owner, 1, [], undefined, TEST_PROGRAM_ID),
        ).to.be.rejectedWith(Error);

        const wrongPermissioned = Keypair.generate();
        const badBurnTx = new Transaction().add(
            createPermissionedBurnCheckedInstruction(
                account,
                mint,
                owner.publicKey,
                wrongPermissioned.publicKey,
                1,
                TEST_TOKEN_DECIMALS,
                [],
                TEST_PROGRAM_ID,
            ),
        );
        await expect(
            sendAndConfirmTransaction(connection, badBurnTx, [payer, owner, wrongPermissioned]),
        ).to.be.rejectedWith(Error);

        const burnTx = new Transaction().add(
            createPermissionedBurnCheckedInstruction(
                account,
                mint,
                owner.publicKey,
                permissionedAuthority.publicKey,
                1,
                TEST_TOKEN_DECIMALS,
                [],
                TEST_PROGRAM_ID,
            ),
        );
        await sendAndConfirmTransaction(connection, burnTx, [payer, owner, permissionedAuthority]);

        const accountInfo = await connection.getTokenAccountBalance(account);
        expect(accountInfo.value.uiAmount).to.eql(1);
        const mintInfo = await getMint(connection, mint, undefined, TEST_PROGRAM_ID);
        expect(mintInfo.supply).to.eql(BigInt(1));
    });
});
