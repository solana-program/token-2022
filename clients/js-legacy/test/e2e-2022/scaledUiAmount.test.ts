import { expect } from 'chai';
import type { Connection, Signer } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';
import { Keypair, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { TEST_PROGRAM_ID, newAccountWithLamports, getConnection } from '../common';

import {
    ExtensionType,
    createInitializeMintInstruction,
    createInitializeScaledUiAmountConfigInstruction,
    getMint,
    getMintLen,
    getScaledUiAmountConfig,
    updateMultiplier,
    setAuthority,
    AuthorityType,
} from '../../src';

const TEST_TOKEN_DECIMALS = 2;
const MINT_EXTENSIONS = [ExtensionType.ScaledUiAmountConfig];

describe('scaledUiAmount', () => {
    let connection: Connection;
    let payer: Signer;
    let owner: Keypair;
    let mint: PublicKey;
    let mintAuthority: Keypair;
    let multiplier: number;
    before(async () => {
        connection = await getConnection();
        payer = await newAccountWithLamports(connection, 1000000000);
        owner = Keypair.generate();
        multiplier = 5.0;
    });

    beforeEach(async () => {
        const mintKeypair = Keypair.generate();
        mint = mintKeypair.publicKey;
        mintAuthority = Keypair.generate();
        const mintLen = getMintLen(MINT_EXTENSIONS);
        const mintLamports = await connection.getMinimumBalanceForRentExemption(mintLen);
        const mintTransaction = new Transaction().add(
            SystemProgram.createAccount({
                fromPubkey: payer.publicKey,
                newAccountPubkey: mint,
                space: mintLen,
                lamports: mintLamports,
                programId: TEST_PROGRAM_ID,
            }),
            createInitializeScaledUiAmountConfigInstruction(mint, owner.publicKey, multiplier, TEST_PROGRAM_ID),
            createInitializeMintInstruction(mint, TEST_TOKEN_DECIMALS, mintAuthority.publicKey, null, TEST_PROGRAM_ID),
        );
        await sendAndConfirmTransaction(connection, mintTransaction, [payer, mintKeypair], undefined);
    });

    it('initialize mint', async () => {
        const mintInfo = await getMint(connection, mint, undefined, TEST_PROGRAM_ID);
        const scaledUiAmountConfig = getScaledUiAmountConfig(mintInfo);
        expect(scaledUiAmountConfig).to.not.equal(null);
        if (scaledUiAmountConfig !== null) {
            expect(scaledUiAmountConfig.authority).to.eql(owner.publicKey);
            expect(scaledUiAmountConfig.multiplier).to.eql(multiplier);
        }
    });

    it('update authority', async () => {
        await setAuthority(
            connection,
            payer,
            mint,
            owner,
            AuthorityType.ScaledUiAmountConfig,
            null,
            [],
            undefined,
            TEST_PROGRAM_ID,
        );
        const mintInfo = await getMint(connection, mint, undefined, TEST_PROGRAM_ID);
        const scaledUiAmountConfig = getScaledUiAmountConfig(mintInfo);
        expect(scaledUiAmountConfig).to.not.equal(null);
        if (scaledUiAmountConfig !== null) {
            expect(scaledUiAmountConfig.authority).to.eql(PublicKey.default);
        }
    });

    it('update multiplier', async () => {
        const newMultiplier = 10.0;
        const effectiveTimestamp = BigInt(1000);

        await updateMultiplier(
            connection,
            payer,
            mint,
            owner,
            newMultiplier,
            effectiveTimestamp,
            [],
            undefined,
            TEST_PROGRAM_ID,
        );
        const mintInfo = await getMint(connection, mint, undefined, TEST_PROGRAM_ID);
        const scaledUiAmountConfig = getScaledUiAmountConfig(mintInfo);
        expect(scaledUiAmountConfig).to.not.equal(null);
        if (scaledUiAmountConfig !== null) {
            expect(scaledUiAmountConfig.multiplier).to.eql(newMultiplier);
            expect(scaledUiAmountConfig.newMultiplierEffectiveTimestamp).to.eql(effectiveTimestamp);
            expect(scaledUiAmountConfig.newMultiplier).to.eql(newMultiplier);
        }
    });
});
