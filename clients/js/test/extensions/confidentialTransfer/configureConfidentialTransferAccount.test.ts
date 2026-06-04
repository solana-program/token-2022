import { address, generateKeyPairSigner } from '@solana/kit';
import test from 'ava';
import { getConfigureConfidentialTransferAccountInstruction } from '../../../src';

const SYSVAR_INSTRUCTIONS_ADDRESS = address('Sysvar1nstructions1111111111111111111111111');
const DECRYPTABLE_ZERO_BALANCE = new Uint8Array(36);

test('it emits exactly 4 accounts in inline-proof mode', async t => {
    const [token, mint, authority] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
        generateKeyPairSigner(),
    ]);

    const instruction = getConfigureConfidentialTransferAccountInstruction({
        token: token.address,
        mint: mint.address,
        authority,
        decryptableZeroBalance: DECRYPTABLE_ZERO_BALANCE,
        maximumPendingBalanceCreditCounter: 65_536n,
        proofInstructionOffset: 1,
    });

    t.is(instruction.accounts.length, 4);
    t.is(instruction.accounts[0].address, token.address);
    t.is(instruction.accounts[1].address, mint.address);
    t.is(instruction.accounts[2].address, SYSVAR_INSTRUCTIONS_ADDRESS);
    t.is(instruction.accounts[3].address, authority.address);
});
