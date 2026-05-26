import { address, generateKeyPairSigner } from '@solana/kit';
import test from 'ava';
import { getConfidentialTransferInstruction, parseConfidentialTransferInstruction } from '../../../src';

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
        instructionsSysvar: address('Sysvar1nstructions1111111111111111111111111'),
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
        instructionsSysvar: address('Sysvar1nstructions1111111111111111111111111'),
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
