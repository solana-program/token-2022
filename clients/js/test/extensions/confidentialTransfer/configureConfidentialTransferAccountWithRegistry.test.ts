import { address, generateKeyPairSigner, type AccountMeta } from '@solana/kit';
import { expect, it } from 'vitest';

import {
    getConfigureConfidentialTransferAccountWithRegistryInstruction,
    parseConfigureConfidentialTransferAccountWithRegistryInstruction,
} from '../../../src';

const SYSTEM_PROGRAM_ADDRESS = address('11111111111111111111111111111111');

it('encodes the 27/14 discriminator pair', async () => {
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

    expect(instruction.data[0]).toBe(27);
    expect(instruction.data[1]).toBe(14);
    expect(instruction.data.length).toBe(2);
});

it('emits a 3-account layout when payer and systemProgram are omitted', async () => {
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

    expect(accounts.length).toBe(3);
    expect(accounts[0].address).toBe(token.address);
    expect(accounts[1].address).toBe(mint.address);
    expect(accounts[2].address).toBe(elgamalRegistry.address);
});

it('emits a 5-account layout when payer is provided', async () => {
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

    expect(accounts.length).toBe(5);
    expect(accounts[3].address).toBe(payer.address);
    expect(accounts[4].address).toBe(SYSTEM_PROGRAM_ADDRESS);
});

it('round-trips through parse', async () => {
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

    expect(parsed.accounts.token.address).toBe(token.address);
    expect(parsed.accounts.mint.address).toBe(mint.address);
    expect(parsed.accounts.elgamalRegistry.address).toBe(elgamalRegistry.address);
});
