import { address, generateKeyPairSigner, type AccountMeta } from '@solana/kit';
import test from 'ava';
import { getConfidentialWithdrawInstruction } from '../../../src';

const SYSVAR_INSTRUCTIONS_ADDRESS = address('Sysvar1nstructions1111111111111111111111111');
const NEW_DECRYPTABLE_BALANCE = new Uint8Array(36);

test('it skips all optional accounts when both proofs are in context-state mode', async t => {
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
    t.is(accounts.length, 5);
    t.is(accounts[0].address, token.address);
    t.is(accounts[1].address, mint.address);
    t.is(accounts[2].address, equalityRecord.address);
    t.is(accounts[3].address, rangeRecord.address);
    t.is(accounts[4].address, authority.address);
});

test('it emits only the sysvar when both proofs are inline', async t => {
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

    t.is(accounts.length, 4);
    t.is(accounts[0].address, token.address);
    t.is(accounts[1].address, mint.address);
    t.is(accounts[2].address, SYSVAR_INSTRUCTIONS_ADDRESS);
    t.is(accounts[3].address, authority.address);
});

test('it emits sysvar plus a single context-state account in mixed mode', async t => {
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

    t.is(accounts.length, 5);
    t.is(accounts[0].address, token.address);
    t.is(accounts[1].address, mint.address);
    t.is(accounts[2].address, SYSVAR_INSTRUCTIONS_ADDRESS);
    t.is(accounts[3].address, equalityRecord.address);
    t.is(accounts[4].address, authority.address);
});
