import { address, AccountRole, generateKeyPairSigner } from '@solana/kit';
import { describe, expect, it } from 'vitest';

import {
    findExtraAccountMetaListPda,
    getDefaultInitializeExtraAccountMetaListInstructionAsync,
    getDefaultUpdateExtraAccountMetaListInstructionAsync,
} from '../../../src';

const transferHookProgramId = address('7N4HggYEJAtCLJdnHGCtFqfxcB5rhQCsQTze3ftYstVj');
const mint = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const plainAddress = address('6c5q79ccBTWvZTEx3JkdHThtMa2eALba5bfvHGf8kA2c');
const systemProgramAddress = address('11111111111111111111111111111111');

describe('getDefaultInitializeExtraAccountMetaListInstructionAsync', () => {
    it('builds the interface initialize instruction', async () => {
        const authority = address('D5jyaVjrWuq7ostc8JYywr3QDPtM6y6TZKG1TgRhZYSp');
        const [extraAccountMetaList] = await findExtraAccountMetaListPda(
            { mint },
            { programAddress: transferHookProgramId },
        );

        const instruction = await getDefaultInitializeExtraAccountMetaListInstructionAsync({
            mint,
            authority,
            extraAccountMetas: [
                { config: { __kind: 'Literal', address: plainAddress }, isSigner: false, isWritable: true },
            ],
            transferHookProgram: transferHookProgramId,
        });

        expect(instruction.programAddress).toBe(transferHookProgramId);
        expect(instruction.accounts).toStrictEqual([
            { address: extraAccountMetaList, role: AccountRole.WRITABLE },
            { address: mint, role: AccountRole.READONLY },
            { address: authority, role: AccountRole.READONLY_SIGNER },
            { address: systemProgramAddress, role: AccountRole.READONLY },
        ]);
    });

    it('attaches the signer when the authority signs', async () => {
        const authority = await generateKeyPairSigner();

        const instruction = await getDefaultInitializeExtraAccountMetaListInstructionAsync({
            mint,
            authority,
            extraAccountMetas: [],
            transferHookProgram: transferHookProgramId,
        });

        expect(instruction.accounts![2]).toStrictEqual({
            address: authority.address,
            role: AccountRole.READONLY_SIGNER,
            signer: authority,
        });
    });

    it('uses an explicit validation account when provided', async () => {
        const authority = address('D5jyaVjrWuq7ostc8JYywr3QDPtM6y6TZKG1TgRhZYSp');
        const explicitList = address('AKPu7hnbAfsjixnPvGReDbmAYUJErkw8H6cRc3ohh2xf');

        const instruction = await getDefaultInitializeExtraAccountMetaListInstructionAsync({
            mint,
            authority,
            extraAccountMetas: [],
            transferHookProgram: transferHookProgramId,
            extraAccountMetaList: explicitList,
        });

        expect(instruction.accounts![0]).toStrictEqual({ address: explicitList, role: AccountRole.WRITABLE });
    });
});

describe('getDefaultUpdateExtraAccountMetaListInstructionAsync', () => {
    it('builds the interface update instruction', async () => {
        const authority = address('D5jyaVjrWuq7ostc8JYywr3QDPtM6y6TZKG1TgRhZYSp');
        const [extraAccountMetaList] = await findExtraAccountMetaListPda(
            { mint },
            { programAddress: transferHookProgramId },
        );

        const instruction = await getDefaultUpdateExtraAccountMetaListInstructionAsync({
            mint,
            authority,
            extraAccountMetas: [
                { config: { __kind: 'Literal', address: plainAddress }, isSigner: false, isWritable: true },
            ],
            transferHookProgram: transferHookProgramId,
        });

        expect(instruction.programAddress).toBe(transferHookProgramId);
        // Update has no system program account.
        expect(instruction.accounts).toStrictEqual([
            { address: extraAccountMetaList, role: AccountRole.WRITABLE },
            { address: mint, role: AccountRole.READONLY },
            { address: authority, role: AccountRole.READONLY_SIGNER },
        ]);
    });
});
