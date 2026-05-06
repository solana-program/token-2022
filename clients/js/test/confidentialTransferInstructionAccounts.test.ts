import { address, generateKeyPairSigner } from '@solana/kit';
import test from 'ava';
import {
    getConfidentialTransferInstruction,
    getConfidentialTransferWithFeeInstruction,
    getConfidentialWithdrawInstruction,
    getConfigureConfidentialTransferAccountInstruction,
    getEmptyConfidentialTransferAccountInstruction,
    parseToken2022Instruction,
    parseConfidentialTransferInstruction,
    parseConfidentialTransferWithFeeInstruction,
    parseConfidentialWithdrawInstruction,
    parseConfigureConfidentialTransferAccountInstruction,
    parseEmptyConfidentialTransferAccountInstruction,
    Token2022Instruction,
} from '../src';

const DECRYPTABLE_BALANCE = new Uint8Array(36);
const SYSVAR_INSTRUCTIONS_ADDRESS = address('Sysvar1nstructions1111111111111111111111111');

const generateAddresses = async (count: number) =>
    await Promise.all([...Array.from({ length: count })].map(async () => (await generateKeyPairSigner()).address));

test('configure confidential transfer defaults the instructions sysvar for inline proofs', async t => {
    const [token, mint, authority] = await generateAddresses(3);

    const instruction = getConfigureConfidentialTransferAccountInstruction({
        token,
        mint,
        authority,
        decryptableZeroBalance: DECRYPTABLE_BALANCE,
        maximumPendingBalanceCreditCounter: 1n,
        proofInstructionOffset: 1,
    });
    const parsed = parseConfigureConfidentialTransferAccountInstruction(instruction);

    t.is(Array.from(instruction.accounts).length, 4);
    t.is(parsed.accounts.instructionsSysvarOrContextState.address, SYSVAR_INSTRUCTIONS_ADDRESS);
    t.is(parsed.accounts.record, undefined);
    t.is(parsed.accounts.authority.address, authority);
});

test('configure confidential transfer requires a context state account when the proof is pre-verified', async t => {
    const [token, mint, authority] = await generateAddresses(3);

    const error = t.throws(() =>
        getConfigureConfidentialTransferAccountInstruction({
            token,
            mint,
            authority,
            decryptableZeroBalance: DECRYPTABLE_BALANCE,
            maximumPendingBalanceCreditCounter: 1n,
            proofInstructionOffset: 0,
        }),
    );

    t.is(error?.message, 'Expected instructionsSysvarOrContextState when proofInstructionOffset is 0');
});

test('empty confidential transfer defaults the instructions sysvar for inline proofs', async t => {
    const [token, authority] = await generateAddresses(2);

    const instruction = getEmptyConfidentialTransferAccountInstruction({
        token,
        authority,
        proofInstructionOffset: 1,
    });
    const parsed = parseEmptyConfidentialTransferAccountInstruction(instruction);

    t.is(Array.from(instruction.accounts).length, 3);
    t.is(parsed.accounts.instructionsSysvarOrContextState.address, SYSVAR_INSTRUCTIONS_ADDRESS);
    t.is(parsed.accounts.record, undefined);
    t.is(parsed.accounts.authority.address, authority);
});

test('empty confidential transfer requires a context state account when the proof is pre-verified', async t => {
    const [token, authority] = await generateAddresses(2);

    const error = t.throws(() =>
        getEmptyConfidentialTransferAccountInstruction({
            token,
            authority,
            proofInstructionOffset: 0,
        }),
    );

    t.is(error?.message, 'Expected instructionsSysvarOrContextState when proofInstructionOffset is 0');
});

test('confidential withdraw defaults the instructions sysvar for inline proofs and omits proof accounts', async t => {
    const [token, mint, authority] = await generateAddresses(3);

    const instruction = getConfidentialWithdrawInstruction({
        token,
        mint,
        authority,
        amount: 1n,
        decimals: 0,
        newDecryptableAvailableBalance: DECRYPTABLE_BALANCE,
        equalityProofInstructionOffset: 1,
        rangeProofInstructionOffset: 2,
    });
    const parsed = parseConfidentialWithdrawInstruction(instruction);

    t.is(Array.from(instruction.accounts).length, 4);
    t.is(parsed.accounts.instructionsSysvar?.address, SYSVAR_INSTRUCTIONS_ADDRESS);
    t.is(parsed.accounts.equalityRecord, undefined);
    t.is(parsed.accounts.rangeRecord, undefined);
    t.is(parsed.accounts.authority.address, authority);
});

test('confidential withdraw requires context state accounts for zero proof offsets', async t => {
    const [token, mint, authority] = await generateAddresses(3);

    const error = t.throws(() =>
        getConfidentialWithdrawInstruction({
            token,
            mint,
            authority,
            amount: 1n,
            decimals: 0,
            newDecryptableAvailableBalance: DECRYPTABLE_BALANCE,
            equalityProofInstructionOffset: 0,
            rangeProofInstructionOffset: 1,
        }),
    );

    t.is(error?.message, 'Expected equalityRecord when equalityProofInstructionOffset is 0');
});

test('confidential withdraw rejects the instructions sysvar when all proofs use context state accounts', async t => {
    const [token, mint, equalityRecord, rangeRecord, authority] = await generateAddresses(5);

    const error = t.throws(() =>
        getConfidentialWithdrawInstruction({
            token,
            mint,
            instructionsSysvar: SYSVAR_INSTRUCTIONS_ADDRESS,
            equalityRecord,
            rangeRecord,
            authority,
            amount: 1n,
            decimals: 0,
            newDecryptableAvailableBalance: DECRYPTABLE_BALANCE,
            equalityProofInstructionOffset: 0,
            rangeProofInstructionOffset: 0,
        }),
    );

    t.is(error?.message, 'instructionsSysvar must be omitted when all proofs use context state accounts');
});

test('confidential transfer parses mixed inline and context-state proofs correctly', async t => {
    const [sourceToken, mint, destinationToken, equalityRecord, rangeRecord, authority] = await generateAddresses(6);

    const instruction = getConfidentialTransferInstruction({
        sourceToken,
        mint,
        destinationToken,
        equalityRecord,
        rangeRecord,
        authority,
        newSourceDecryptableAvailableBalance: DECRYPTABLE_BALANCE,
        equalityProofInstructionOffset: 0,
        ciphertextValidityProofInstructionOffset: 1,
        rangeProofInstructionOffset: 0,
    });
    const parsed = parseConfidentialTransferInstruction(instruction);

    t.is(Array.from(instruction.accounts).length, 7);
    t.is(parsed.accounts.instructionsSysvar?.address, SYSVAR_INSTRUCTIONS_ADDRESS);
    t.is(parsed.accounts.equalityRecord?.address, equalityRecord);
    t.is(parsed.accounts.ciphertextValidityRecord, undefined);
    t.is(parsed.accounts.rangeRecord?.address, rangeRecord);
    t.is(parsed.accounts.authority.address, authority);
});

test('confidential transfer with fee parses mixed inline and context-state proofs correctly', async t => {
    const [sourceToken, mint, destinationToken, equalityRecord, feeSigmaRecord, rangeRecord, authority] =
        await generateAddresses(7);

    const instruction = getConfidentialTransferWithFeeInstruction({
        sourceToken,
        mint,
        destinationToken,
        equalityRecord,
        feeSigmaRecord,
        rangeRecord,
        authority,
        newSourceDecryptableAvailableBalance: DECRYPTABLE_BALANCE,
        equalityProofInstructionOffset: 0,
        transferAmountCiphertextValidityProofInstructionOffset: 1,
        feeSigmaProofInstructionOffset: 0,
        feeCiphertextValidityProofInstructionOffset: 2,
        rangeProofInstructionOffset: 0,
    });
    const parsed = parseConfidentialTransferWithFeeInstruction(instruction);

    t.is(Array.from(instruction.accounts).length, 8);
    t.is(parsed.accounts.instructionsSysvar?.address, SYSVAR_INSTRUCTIONS_ADDRESS);
    t.is(parsed.accounts.equalityRecord?.address, equalityRecord);
    t.is(parsed.accounts.transferAmountCiphertextValidityRecord, undefined);
    t.is(parsed.accounts.feeSigmaRecord?.address, feeSigmaRecord);
    t.is(parsed.accounts.feeCiphertextValidityRecord, undefined);
    t.is(parsed.accounts.rangeRecord?.address, rangeRecord);
    t.is(parsed.accounts.authority.address, authority);
});

test('token-2022 parser uses the handwritten confidential transfer parser overrides', async t => {
    const [sourceToken, mint, destinationToken, equalityRecord, rangeRecord, authority] = await generateAddresses(6);

    const instruction = getConfidentialTransferInstruction({
        sourceToken,
        mint,
        destinationToken,
        equalityRecord,
        rangeRecord,
        authority,
        newSourceDecryptableAvailableBalance: DECRYPTABLE_BALANCE,
        equalityProofInstructionOffset: 0,
        ciphertextValidityProofInstructionOffset: 1,
        rangeProofInstructionOffset: 0,
    });
    const parsed = parseToken2022Instruction(instruction);

    t.is(parsed.instructionType, Token2022Instruction.ConfidentialTransfer);
    if (parsed.instructionType !== Token2022Instruction.ConfidentialTransfer) {
        return;
    }

    t.is(parsed.accounts.instructionsSysvar?.address, SYSVAR_INSTRUCTIONS_ADDRESS);
    t.is(parsed.accounts.equalityRecord?.address, equalityRecord);
    t.is(parsed.accounts.ciphertextValidityRecord, undefined);
    t.is(parsed.accounts.rangeRecord?.address, rangeRecord);
    t.is(parsed.accounts.authority.address, authority);
});
