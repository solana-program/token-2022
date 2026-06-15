import { address, generateKeyPairSigner, type AccountMeta } from '@solana/kit';
import { expect, it } from 'vitest';

import { getConfidentialWithdrawInstruction } from '../../../src';

const SYSVAR_INSTRUCTIONS_ADDRESS = address('Sysvar1nstructions1111111111111111111111111');
const NEW_DECRYPTABLE_BALANCE = new Uint8Array(36);

it('skips all optional accounts when both proofs are in context-state mode', async () => {
    const [token, mint, equalityRecord, rangeRecord, authority] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    const instruction = getConfidentialWithdrawInstruction({
        token: token.address,
        mint: mint.address,
        equalityRecord: equalityRecord.address,
        rangeRecord: rangeRecord.address,
        authority,
        amount: 1n,
        decimals: 0,
        newDecryptableAvailableBalance: NEW_DECRYPTABLE_BALANCE,
        equalityProofInstructionOffset: 0,
        rangeProofInstructionOffset: 0,
    });
    const accounts = instruction.accounts as readonly AccountMeta[];

    // Layout when both proofs are pre-verified into context state: token, mint,
    // equalityRecord, rangeRecord, authority. No sysvar in the accounts list.
    expect(accounts.length).toBe(5);
    expect(accounts[0].address).toBe(token.address);
    expect(accounts[1].address).toBe(mint.address);
    expect(accounts[2].address).toBe(equalityRecord.address);
    expect(accounts[3].address).toBe(rangeRecord.address);
    expect(accounts[4].address).toBe(authority.address);
});

it('emits only the sysvar when both proofs are inline', async () => {
    const [token, mint, authority] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    const instruction = getConfidentialWithdrawInstruction({
        token: token.address,
        mint: mint.address,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_ADDRESS,
        authority,
        amount: 1n,
        decimals: 0,
        newDecryptableAvailableBalance: NEW_DECRYPTABLE_BALANCE,
        equalityProofInstructionOffset: 1,
        rangeProofInstructionOffset: 2,
    });
    const accounts = instruction.accounts as readonly AccountMeta[];

    expect(accounts.length).toBe(4);
    expect(accounts[0].address).toBe(token.address);
    expect(accounts[1].address).toBe(mint.address);
    expect(accounts[2].address).toBe(SYSVAR_INSTRUCTIONS_ADDRESS);
    expect(accounts[3].address).toBe(authority.address);
});

it('emits sysvar plus a single context-state account in mixed mode', async () => {
    const [token, mint, equalityRecord, authority] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    const instruction = getConfidentialWithdrawInstruction({
        token: token.address,
        mint: mint.address,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_ADDRESS,
        equalityRecord: equalityRecord.address,
        authority,
        amount: 1n,
        decimals: 0,
        newDecryptableAvailableBalance: NEW_DECRYPTABLE_BALANCE,
        equalityProofInstructionOffset: 0,
        rangeProofInstructionOffset: 1,
    });
    const accounts = instruction.accounts as readonly AccountMeta[];

    expect(accounts.length).toBe(5);
    expect(accounts[0].address).toBe(token.address);
    expect(accounts[1].address).toBe(mint.address);
    expect(accounts[2].address).toBe(SYSVAR_INSTRUCTIONS_ADDRESS);
    expect(accounts[3].address).toBe(equalityRecord.address);
    expect(accounts[4].address).toBe(authority.address);
});
