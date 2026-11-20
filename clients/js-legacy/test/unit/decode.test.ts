import { Keypair, PublicKey } from '@solana/web3.js';
import type { Mint } from '../../src';
import { expect } from 'chai';
import {
    createInitializeMintCloseAuthorityInstruction,
    createInitializePermanentDelegateInstruction,
    TOKEN_2022_PROGRAM_ID,
    ExtensionType,
    getMintCloseAuthority,
    MintCloseAuthorityLayout,
    getPermanentDelegate,
    PermanentDelegateLayout,
    getInterestBearingMintConfigState,
    InterestBearingMintConfigStateLayout,
    getTransferFeeConfig,
    TransferFeeConfigLayout,
    getTransferHook,
    TransferHookLayout,
} from '../../src';

describe('spl-token-2022 instructions', () => {
    it('InitializeMintCloseAuthority', () => {
        const ix = createInitializeMintCloseAuthorityInstruction(
            Keypair.generate().publicKey,
            Keypair.generate().publicKey,
            TOKEN_2022_PROGRAM_ID,
        );
        expect(ix.programId).to.eql(TOKEN_2022_PROGRAM_ID);
        expect(ix.keys).to.have.length(1);
    });
    it('InitializePermanentDelegate', () => {
        const ix = createInitializePermanentDelegateInstruction(
            Keypair.generate().publicKey,
            Keypair.generate().publicKey,
            TOKEN_2022_PROGRAM_ID,
        );
        expect(ix.programId).to.eql(TOKEN_2022_PROGRAM_ID);
        expect(ix.keys).to.have.length(1);
    });
});

describe('nullable extension state', () => {
    const present = new PublicKey(Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)));
    const extensions = [
        {
            type: ExtensionType.MintCloseAuthority,
            layout: MintCloseAuthorityLayout,
            getState: getMintCloseAuthority,
            fields: ['closeAuthority'],
        },
        {
            type: ExtensionType.PermanentDelegate,
            layout: PermanentDelegateLayout,
            getState: getPermanentDelegate,
            fields: ['delegate'],
        },
        {
            type: ExtensionType.InterestBearingConfig,
            layout: InterestBearingMintConfigStateLayout,
            getState: getInterestBearingMintConfigState,
            fields: ['rateAuthority'],
        },
        {
            type: ExtensionType.TransferFeeConfig,
            layout: TransferFeeConfigLayout,
            getState: getTransferFeeConfig,
            fields: ['transferFeeConfigAuthority', 'withdrawWithheldAuthority'],
        },
        {
            type: ExtensionType.TransferHook,
            layout: TransferHookLayout,
            getState: getTransferHook,
            fields: ['authority', 'programId'],
        },
    ];

    for (const { type, layout, getState, fields } of extensions) {
        describe(ExtensionType[type], () => {
            for (let mask = 0; mask < 1 << fields.length; mask++) {
                it('decodes optional keys for presence mask ' + mask, () => {
                    const extensionData = Buffer.alloc(layout.span);
                    const expectedKeys: Record<string, PublicKey | null> = {};
                    const rawKeys: Record<string, PublicKey> = {};
                    for (const [index, field] of fields.entries()) {
                        const key = mask & (1 << index) ? present : PublicKey.default;
                        key.toBuffer().copy(extensionData, index * 32);
                        expectedKeys[field] = mask & (1 << index) ? present : null;
                        rawKeys[field] = key;
                    }
                    if (type === ExtensionType.InterestBearingConfig) {
                        extensionData.writeBigInt64LE(123n, 32);
                        extensionData.writeInt16LE(-7, 40);
                        extensionData.writeBigInt64LE(456n, 42);
                        extensionData.writeInt16LE(9, 50);
                    } else if (type === ExtensionType.TransferFeeConfig) {
                        extensionData.writeBigUInt64LE(11n, 64);
                        extensionData.writeBigUInt64LE(12n, 72);
                        extensionData.writeBigUInt64LE(13n, 80);
                        extensionData.writeUInt16LE(14, 88);
                        extensionData.writeBigUInt64LE(15n, 90);
                        extensionData.writeBigUInt64LE(16n, 98);
                        extensionData.writeUInt16LE(17, 106);
                    }
                    const tlvData = Buffer.alloc(4 + extensionData.length);
                    tlvData.writeUInt16LE(type, 0);
                    tlvData.writeUInt16LE(extensionData.length, 2);
                    extensionData.copy(tlvData, 4);

                    // Raw layouts retain the 32-byte sentinel; public getters expose absence.
                    const raw = layout.decode(extensionData);
                    expect(raw).to.deep.include(rawKeys);
                    expect(getState({ tlvData } as Mint)).to.deep.equal({ ...raw, ...expectedKeys });
                });
            }

            it('returns null when the extension is absent', () => {
                expect(getState({ tlvData: Buffer.alloc(0) } as Mint)).to.equal(null);
            });
        });
    }
});
