import type { Connection, Signer } from '@solana/web3.js';
import { PublicKey, Keypair } from '@solana/web3.js';

import {
    getMint,
    getAccount,
    createWrappedNativeAccount,
    NATIVE_MINT_2022,
    createNativeMint,
    getAccountLen,
    ExtensionType,
} from '../../src';

import { TEST_PROGRAM_ID, newAccountWithLamports, getConnection } from '../common';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { unwrapLamports } from '../../src/actions/unwrapLamports';
use(chaiAsPromised);

describe('unwrapLamports', () => {
    let connection: Connection;
    let payer: Signer;
    let owner: Keypair;
    let account1: PublicKey;
    let account2: PublicKey;
    let balance: number;
    before(async () => {
        connection = await getConnection();
        payer = await newAccountWithLamports(connection, 1500000000);

        try {
            await getMint(connection, NATIVE_MINT_2022, undefined, TEST_PROGRAM_ID);
        } catch (err) {
            // would throw an error if it doesn't exist
            await createNativeMint(connection, payer, undefined, NATIVE_MINT_2022, TEST_PROGRAM_ID);
        }
    });
    beforeEach(async () => {
        owner = Keypair.generate();
        balance = 500000000;
        account1 = await createWrappedNativeAccount(
            connection,
            payer,
            owner.publicKey,
            balance,
            undefined,
            undefined,
            TEST_PROGRAM_ID,
            NATIVE_MINT_2022,
        );
        account2 = PublicKey.unique();
    });
    it('unwrapLamports with Some', async () => {
        let amount = balance / 2;
        await unwrapLamports(
            connection,
            payer,
            account1,
            account2,
            owner,
            BigInt(amount),
            [],
            undefined,
            TEST_PROGRAM_ID,
        );

        const destLamports = await connection.getBalance(account2);
        expect(BigInt(destLamports)).to.eql(BigInt(amount));

        balance = balance - amount;

        const wrappedAccountSpace = getAccountLen([ExtensionType.ImmutableOwner]); // source account is an ata
        const wrappedAccountLamports = await connection.getMinimumBalanceForRentExemption(wrappedAccountSpace);

        const sourceAccountInfo = await getAccount(connection, account1, undefined, TEST_PROGRAM_ID);
        const sourceLamports = await connection.getBalance(account1);
        expect(sourceAccountInfo.amount).to.eql(BigInt(balance));
        expect(sourceLamports).to.eql(wrappedAccountLamports + balance);

        amount = balance + 1;
        expect(
            unwrapLamports(
                connection,
                payer,
                account1,
                account2,
                owner,
                BigInt(amount),
                [],
                undefined,
                TEST_PROGRAM_ID,
            ),
        ).to.be.rejectedWith(Error);
    });
    it('unwrapLamports with None', async () => {
        const amount = null;
        await unwrapLamports(connection, payer, account1, account2, owner, amount, [], undefined, TEST_PROGRAM_ID);

        const wrappedAccountSpace = getAccountLen([ExtensionType.ImmutableOwner]); // source account is an ata
        const wrappedAccountLamports = await connection.getMinimumBalanceForRentExemption(wrappedAccountSpace);

        const destLamports = await connection.getBalance(account2);
        expect(destLamports).to.eql(balance);

        const sourceAccountInfo = await getAccount(connection, account1, undefined, TEST_PROGRAM_ID);
        const sourceLamports = await connection.getBalance(account1);
        expect(sourceAccountInfo.amount).to.eql(0n);
        expect(sourceLamports).to.eql(wrappedAccountLamports);
    });
});
