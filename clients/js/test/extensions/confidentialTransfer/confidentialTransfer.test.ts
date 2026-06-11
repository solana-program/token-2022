import { expect, it } from 'vitest';
import { address, generateKeyPairSigner, type AccountMeta } from '@solana/kit';
import { getConfidentialTransferInstruction, parseConfidentialTransferInstruction } from '../../../src';

const SYSVAR_INSTRUCTIONS_ADDRESS = address('Sysvar1nstructions1111111111111111111111111');
const SOURCE_AUDITOR_CIPHERTEXT_LO = new Uint8Array(64).fill(0xab);
const SOURCE_AUDITOR_CIPHERTEXT_HI = new Uint8Array(64).fill(0xcd);
const NEW_SOURCE_DECRYPTABLE_BALANCE = new Uint8Array(36).fill(0xef);

it('encodes the auditor ciphertext fields into the Transfer instruction data', async () => {
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

    expect(parsed.data.transferAmountAuditorCiphertextLo).toEqual(SOURCE_AUDITOR_CIPHERTEXT_LO);
    expect(parsed.data.transferAmountAuditorCiphertextHi).toEqual(SOURCE_AUDITOR_CIPHERTEXT_HI);
    expect(parsed.data.newSourceDecryptableAvailableBalance).toEqual(NEW_SOURCE_DECRYPTABLE_BALANCE);
    expect(parsed.data.equalityProofInstructionOffset).toBe(1);
    expect(parsed.data.ciphertextValidityProofInstructionOffset).toBe(2);
    expect(parsed.data.rangeProofInstructionOffset).toBe(3);
});

it('encodes the auditor ciphertexts at the documented byte offsets', async () => {
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
    expect(instruction.data.slice(38, 102)).toEqual(SOURCE_AUDITOR_CIPHERTEXT_LO);
    expect(instruction.data.slice(102, 166)).toEqual(SOURCE_AUDITOR_CIPHERTEXT_HI);
});

it('skips all optional accounts when every proof is in context-state mode', async () => {
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

    expect(accounts.length).toBe(7);
    expect(accounts[0].address).toBe(sourceToken.address);
    expect(accounts[1].address).toBe(mint.address);
    expect(accounts[2].address).toBe(destinationToken.address);
    expect(accounts[3].address).toBe(equalityRecord.address);
    expect(accounts[4].address).toBe(ciphertextValidityRecord.address);
    expect(accounts[5].address).toBe(rangeRecord.address);
    expect(accounts[6].address).toBe(authority.address);
});

it('emits only the sysvar when every proof is inline', async () => {
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

    expect(accounts.length).toBe(5);
    expect(accounts[0].address).toBe(sourceToken.address);
    expect(accounts[1].address).toBe(mint.address);
    expect(accounts[2].address).toBe(destinationToken.address);
    expect(accounts[3].address).toBe(SYSVAR_INSTRUCTIONS_ADDRESS);
    expect(accounts[4].address).toBe(authority.address);
});

it('emits sysvar plus only the context-state records that are provided in mixed mode', async () => {
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

    expect(accounts.length).toBe(6);
    expect(accounts[0].address).toBe(sourceToken.address);
    expect(accounts[1].address).toBe(mint.address);
    expect(accounts[2].address).toBe(destinationToken.address);
    expect(accounts[3].address).toBe(SYSVAR_INSTRUCTIONS_ADDRESS);
    expect(accounts[4].address).toBe(equalityRecord.address);
    expect(accounts[5].address).toBe(authority.address);
});
