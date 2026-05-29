import { address, generateKeyPairSigner, type AccountMeta } from '@solana/kit';
import test from 'ava';
import {
    getConfigureConfidentialTransferAccountWithRegistryInstruction,
    parseConfigureConfidentialTransferAccountWithRegistryInstruction,
} from '../../../src';

const SYSTEM_PROGRAM_ADDRESS = address('11111111111111111111111111111111');

test('it encodes the 27/14 discriminator pair', async t => {
    const [token, mint, elgamalRegistry] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    const instruction = getConfigureConfidentialTransferAccountWithRegistryInstruction({
        token: token.address,
        mint: mint.address,
        elgamalRegistry: elgamalRegistry.address,
    });

    t.is(instruction.data[0], 27);
    t.is(instruction.data[1], 14);
    t.is(instruction.data.length, 2);
});

test('it emits a 3-account layout when payer and systemProgram are omitted', async t => {
    const [token, mint, elgamalRegistry] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    const instruction = getConfigureConfidentialTransferAccountWithRegistryInstruction({
        token: token.address,
        mint: mint.address,
        elgamalRegistry: elgamalRegistry.address,
    });
    const accounts = instruction.accounts as readonly AccountMeta[];

    t.is(accounts.length, 3);
    t.is(accounts[0].address, token.address);
    t.is(accounts[1].address, mint.address);
    t.is(accounts[2].address, elgamalRegistry.address);
});

test('it emits a 5-account layout when payer is provided', async t => {
    const [token, mint, elgamalRegistry, payer] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    const instruction = getConfigureConfidentialTransferAccountWithRegistryInstruction({
        token: token.address,
        mint: mint.address,
        elgamalRegistry: elgamalRegistry.address,
        payer,
        systemProgram: SYSTEM_PROGRAM_ADDRESS,
    });
    const accounts = instruction.accounts as readonly AccountMeta[];

    t.is(accounts.length, 5);
    t.is(accounts[3].address, payer.address);
    t.is(accounts[4].address, SYSTEM_PROGRAM_ADDRESS);
});

test('it round-trips through parse', async t => {
    const [token, mint, elgamalRegistry] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    const instruction = getConfigureConfidentialTransferAccountWithRegistryInstruction({
        token: token.address,
        mint: mint.address,
        elgamalRegistry: elgamalRegistry.address,
    });
    const parsed = parseConfigureConfidentialTransferAccountWithRegistryInstruction(instruction);

    t.is(parsed.accounts.token.address, token.address);
    t.is(parsed.accounts.mint.address, mint.address);
    t.is(parsed.accounts.elgamalRegistry.address, elgamalRegistry.address);
});
