import { expect, it } from 'vitest';
import { address, generateKeyPairSigner } from '@solana/kit';
import { getConfigureConfidentialTransferAccountInstruction } from '../../../src';

const SYSVAR_INSTRUCTIONS_ADDRESS = address('Sysvar1nstructions1111111111111111111111111');
const DECRYPTABLE_ZERO_BALANCE = new Uint8Array(36);

it('emits exactly 4 accounts in inline-proof mode', async () => {
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

    expect(instruction.accounts.length).toBe(4);
    expect(instruction.accounts[0].address).toBe(token.address);
    expect(instruction.accounts[1].address).toBe(mint.address);
    expect(instruction.accounts[2].address).toBe(SYSVAR_INSTRUCTIONS_ADDRESS);
    expect(instruction.accounts[3].address).toBe(authority.address);
});
