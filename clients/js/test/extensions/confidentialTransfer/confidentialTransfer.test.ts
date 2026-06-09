import { address, generateKeyPairSigner, type AccountMeta } from '@solana/kit';
import test from 'ava';
import { getConfidentialTransferInstruction, parseConfidentialTransferInstruction } from '../../../src';

const SYSVAR_INSTRUCTIONS_ADDRESS = address('Sysvar1nstructions1111111111111111111111111');
const SOURCE_AUDITOR_CIPHERTEXT_LO = new Uint8Array(64).fill(0xab);
const SOURCE_AUDITOR_CIPHERTEXT_HI = new Uint8Array(64).fill(0xcd);
const NEW_SOURCE_DECRYPTABLE_BALANCE = new Uint8Array(36).fill(0xef);

test('it encodes the auditor ciphertext fields into the Transfer instruction data', async t => {
    const [sourceToken, mint, destinationToken, authority] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    const instruction = getConfidentialTransferInstruction({
        sourceToken: sourceToken.address,
        mint: mint.address,
        destinationToken: destinationToken.address,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_ADDRESS,
        authority,
        newSourceDecryptableAvailableBalance: NEW_SOURCE_DECRYPTABLE_BALANCE,
        transferAmountAuditorCiphertextLo: SOURCE_AUDITOR_CIPHERTEXT_LO,
        transferAmountAuditorCiphertextHi: SOURCE_AUDITOR_CIPHERTEXT_HI,
        equalityProofInstructionOffset: 1,
        ciphertextValidityProofInstructionOffset: 2,
        rangeProofInstructionOffset: 3,
    });

    const parsed = parseConfidentialTransferInstruction(instruction);

    t.deepEqual(parsed.data.transferAmountAuditorCiphertextLo, SOURCE_AUDITOR_CIPHERTEXT_LO);
    t.deepEqual(parsed.data.transferAmountAuditorCiphertextHi, SOURCE_AUDITOR_CIPHERTEXT_HI);
    t.deepEqual(parsed.data.newSourceDecryptableAvailableBalance, NEW_SOURCE_DECRYPTABLE_BALANCE);
    t.is(parsed.data.equalityProofInstructionOffset, 1);
    t.is(parsed.data.ciphertextValidityProofInstructionOffset, 2);
    t.is(parsed.data.rangeProofInstructionOffset, 3);
});

test('it encodes the auditor ciphertexts at the documented byte offsets', async t => {
    const [sourceToken, mint, destinationToken, equalityRecord, ciphertextValidityRecord, rangeRecord, authority] =
        await Promise.all([
            generateKeyPairSigner(),
            generateKeyPairSigner(),
            generateKeyPairSigner(),
            generateKeyPairSigner(),
            generateKeyPairSigner(),
            generateKeyPairSigner(),
            generateKeyPairSigner(),
        ]);

    const instruction = getConfidentialTransferInstruction({
        sourceToken: sourceToken.address,
        mint: mint.address,
        destinationToken: destinationToken.address,
        equalityRecord: equalityRecord.address,
        ciphertextValidityRecord: ciphertextValidityRecord.address,
        rangeRecord: rangeRecord.address,
        authority,
        newSourceDecryptableAvailableBalance: NEW_SOURCE_DECRYPTABLE_BALANCE,
        transferAmountAuditorCiphertextLo: SOURCE_AUDITOR_CIPHERTEXT_LO,
        transferAmountAuditorCiphertextHi: SOURCE_AUDITOR_CIPHERTEXT_HI,
        equalityProofInstructionOffset: 0,
        ciphertextValidityProofInstructionOffset: 0,
        rangeProofInstructionOffset: 0,
    });

    // Data layout: 1 byte outer disc + 1 byte inner disc + 36 bytes AE balance
    // = 38 bytes before the lo ciphertext, 102 bytes before the hi ciphertext.
    t.deepEqual(instruction.data.slice(38, 102), SOURCE_AUDITOR_CIPHERTEXT_LO);
    t.deepEqual(instruction.data.slice(102, 166), SOURCE_AUDITOR_CIPHERTEXT_HI);
});

test('it skips all optional accounts when every proof is in context-state mode', async t => {
    const [sourceToken, mint, destinationToken, equalityRecord, ciphertextValidityRecord, rangeRecord, authority] =
        await Promise.all([
            generateKeyPairSigner(),
            generateKeyPairSigner(),
            generateKeyPairSigner(),
            generateKeyPairSigner(),
            generateKeyPairSigner(),
            generateKeyPairSigner(),
            generateKeyPairSigner(),
        ]);

    const instruction = getConfidentialTransferInstruction({
        sourceToken: sourceToken.address,
        mint: mint.address,
        destinationToken: destinationToken.address,
        equalityRecord: equalityRecord.address,
        ciphertextValidityRecord: ciphertextValidityRecord.address,
        rangeRecord: rangeRecord.address,
        authority,
        newSourceDecryptableAvailableBalance: NEW_SOURCE_DECRYPTABLE_BALANCE,
        transferAmountAuditorCiphertextLo: SOURCE_AUDITOR_CIPHERTEXT_LO,
        transferAmountAuditorCiphertextHi: SOURCE_AUDITOR_CIPHERTEXT_HI,
        equalityProofInstructionOffset: 0,
        ciphertextValidityProofInstructionOffset: 0,
        rangeProofInstructionOffset: 0,
    });
    const accounts = instruction.accounts as readonly AccountMeta[];

    t.is(accounts.length, 7);
    t.is(accounts[0].address, sourceToken.address);
    t.is(accounts[1].address, mint.address);
    t.is(accounts[2].address, destinationToken.address);
    t.is(accounts[3].address, equalityRecord.address);
    t.is(accounts[4].address, ciphertextValidityRecord.address);
    t.is(accounts[5].address, rangeRecord.address);
    t.is(accounts[6].address, authority.address);
});

test('it emits only the sysvar when every proof is inline', async t => {
    const [sourceToken, mint, destinationToken, authority] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    const instruction = getConfidentialTransferInstruction({
        sourceToken: sourceToken.address,
        mint: mint.address,
        destinationToken: destinationToken.address,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_ADDRESS,
        authority,
        newSourceDecryptableAvailableBalance: NEW_SOURCE_DECRYPTABLE_BALANCE,
        transferAmountAuditorCiphertextLo: SOURCE_AUDITOR_CIPHERTEXT_LO,
        transferAmountAuditorCiphertextHi: SOURCE_AUDITOR_CIPHERTEXT_HI,
        equalityProofInstructionOffset: 1,
        ciphertextValidityProofInstructionOffset: 2,
        rangeProofInstructionOffset: 3,
    });
    const accounts = instruction.accounts as readonly AccountMeta[];

    t.is(accounts.length, 5);
    t.is(accounts[0].address, sourceToken.address);
    t.is(accounts[1].address, mint.address);
    t.is(accounts[2].address, destinationToken.address);
    t.is(accounts[3].address, SYSVAR_INSTRUCTIONS_ADDRESS);
    t.is(accounts[4].address, authority.address);
});

test('it emits sysvar plus only the context-state records that are provided in mixed mode', async t => {
    const [sourceToken, mint, destinationToken, equalityRecord, authority] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    const instruction = getConfidentialTransferInstruction({
        sourceToken: sourceToken.address,
        mint: mint.address,
        destinationToken: destinationToken.address,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_ADDRESS,
        equalityRecord: equalityRecord.address,
        authority,
        newSourceDecryptableAvailableBalance: NEW_SOURCE_DECRYPTABLE_BALANCE,
        transferAmountAuditorCiphertextLo: SOURCE_AUDITOR_CIPHERTEXT_LO,
        transferAmountAuditorCiphertextHi: SOURCE_AUDITOR_CIPHERTEXT_HI,
        equalityProofInstructionOffset: 0,
        ciphertextValidityProofInstructionOffset: 1,
        rangeProofInstructionOffset: 2,
    });
    const accounts = instruction.accounts as readonly AccountMeta[];

    t.is(accounts.length, 6);
    t.is(accounts[0].address, sourceToken.address);
    t.is(accounts[1].address, mint.address);
    t.is(accounts[2].address, destinationToken.address);
    t.is(accounts[3].address, SYSVAR_INSTRUCTIONS_ADDRESS);
    t.is(accounts[4].address, equalityRecord.address);
    t.is(accounts[5].address, authority.address);
});
