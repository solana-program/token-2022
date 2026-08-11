import { generateKeyPairSigner, none, some, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';

import {
    INITIALIZE_TOKEN_GROUP_MEMBER_DISCRIMINATOR,
    getEmitTokenMetadataInstruction,
    getInitializeTokenGroupInstruction,
    getInitializeTokenGroupMemberInstruction,
    getInitializeTokenMetadataInstruction,
    getRemoveTokenMetadataKeyInstruction,
    getUpdateTokenGroupMaxSizeInstruction,
    getUpdateTokenGroupUpdateAuthorityInstruction,
    getUpdateTokenMetadataFieldInstruction,
    getUpdateTokenMetadataUpdateAuthorityInstruction,
    parseEmitTokenMetadataInstruction,
    parseInitializeTokenGroupInstruction,
    parseInitializeTokenGroupMemberInstruction,
    parseInitializeTokenMetadataInstruction,
    parseRemoveTokenMetadataKeyInstruction,
    parseUpdateTokenGroupMaxSizeInstruction,
    parseUpdateTokenGroupUpdateAuthorityInstruction,
    parseUpdateTokenMetadataFieldInstruction,
    parseUpdateTokenMetadataUpdateAuthorityInstruction,
} from '../src';

const ADDRESS = '11111111111111111111111111111112' as Address;

describe('token metadata instructions', () => {
    it('round-trips InitializeTokenMetadata', async () => {
        const mintAuthority = await generateKeyPairSigner();
        const instruction = getInitializeTokenMetadataInstruction({
            metadata: ADDRESS,
            updateAuthority: ADDRESS,
            mint: ADDRESS,
            mintAuthority,
            name: 'My Token',
            symbol: 'MTK',
            uri: 'https://example.com/token.json',
        });

        const { data } = parseInitializeTokenMetadataInstruction(instruction);

        expect(data.name).toBe('My Token');
        expect(data.symbol).toBe('MTK');
        expect(data.uri).toBe('https://example.com/token.json');
    });

    it('round-trips UpdateTokenMetadataField', async () => {
        const updateAuthority = await generateKeyPairSigner();
        const instruction = getUpdateTokenMetadataFieldInstruction({
            metadata: ADDRESS,
            updateAuthority,
            field: { __kind: 'Key', fields: ['custom'] },
            value: 'value',
        });

        const { data } = parseUpdateTokenMetadataFieldInstruction(instruction);

        expect(data.field).toStrictEqual({ __kind: 'Key', fields: ['custom'] });
        expect(data.value).toBe('value');
    });

    it('round-trips RemoveTokenMetadataKey', async () => {
        const updateAuthority = await generateKeyPairSigner();
        const instruction = getRemoveTokenMetadataKeyInstruction({
            metadata: ADDRESS,
            updateAuthority,
            idempotent: true,
            key: 'custom',
        });

        const { data } = parseRemoveTokenMetadataKeyInstruction(instruction);

        expect(data.idempotent).toBe(true);
        expect(data.key).toBe('custom');
    });

    it('round-trips UpdateTokenMetadataUpdateAuthority', async () => {
        const updateAuthority = await generateKeyPairSigner();
        const instruction = getUpdateTokenMetadataUpdateAuthorityInstruction({
            metadata: ADDRESS,
            updateAuthority,
            newUpdateAuthority: some(ADDRESS),
        });

        const { data } = parseUpdateTokenMetadataUpdateAuthorityInstruction(instruction);

        expect(data.newUpdateAuthority).toStrictEqual(some(ADDRESS));
    });

    it('round-trips EmitTokenMetadata', () => {
        const instruction = getEmitTokenMetadataInstruction({
            metadata: ADDRESS,
            start: some(4n),
            end: some(20n),
        });

        const { data } = parseEmitTokenMetadataInstruction(instruction);

        expect(data.start).toStrictEqual(some(4n));
        expect(data.end).toStrictEqual(some(20n));
    });
});

describe('token group instructions', () => {
    it('round-trips InitializeTokenGroup', async () => {
        const mintAuthority = await generateKeyPairSigner();
        const instruction = getInitializeTokenGroupInstruction({
            group: ADDRESS,
            mint: ADDRESS,
            mintAuthority,
            updateAuthority: none(),
            maxSize: 100n,
        });

        const { data } = parseInitializeTokenGroupInstruction(instruction);

        expect(data.updateAuthority).toStrictEqual(none());
        expect(data.maxSize).toBe(100n);
    });

    it('round-trips UpdateTokenGroupMaxSize', async () => {
        const updateAuthority = await generateKeyPairSigner();
        const instruction = getUpdateTokenGroupMaxSizeInstruction({
            group: ADDRESS,
            updateAuthority,
            maxSize: 30_000n,
        });

        const { data } = parseUpdateTokenGroupMaxSizeInstruction(instruction);

        expect(data.maxSize).toBe(30_000n);
    });

    it('round-trips UpdateTokenGroupUpdateAuthority', async () => {
        const updateAuthority = await generateKeyPairSigner();
        const instruction = getUpdateTokenGroupUpdateAuthorityInstruction({
            group: ADDRESS,
            updateAuthority,
            newUpdateAuthority: some(ADDRESS),
        });

        const { data } = parseUpdateTokenGroupUpdateAuthorityInstruction(instruction);

        expect(data.newUpdateAuthority).toStrictEqual(some(ADDRESS));
    });

    it('round-trips InitializeTokenGroupMember', async () => {
        const [memberMintAuthority, groupUpdateAuthority] = await Promise.all([
            generateKeyPairSigner(),
            generateKeyPairSigner(),
        ]);
        const instruction = getInitializeTokenGroupMemberInstruction({
            member: ADDRESS,
            memberMint: ADDRESS,
            memberMintAuthority,
            group: ADDRESS,
            groupUpdateAuthority,
        });

        const { data } = parseInitializeTokenGroupMemberInstruction(instruction);

        expect(data.discriminator).toStrictEqual(INITIALIZE_TOKEN_GROUP_MEMBER_DISCRIMINATOR);
    });
});
