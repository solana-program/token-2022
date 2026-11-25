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

describe('mint close authority state', () => {
    const presentCloseAuthority = PublicKey.unique();

    for (const closeAuthority of [presentCloseAuthority, null]) {
        it(`decodes ${closeAuthority ? 'present' : 'absent'} authority`, () => {
            const rawState = {
                closeAuthority: closeAuthority ?? PublicKey.default,
            };
            const tlvData = Buffer.alloc(4 + MintCloseAuthorityLayout.span);
            tlvData.writeUInt16LE(ExtensionType.MintCloseAuthority, 0);
            tlvData.writeUInt16LE(MintCloseAuthorityLayout.span, 2);
            MintCloseAuthorityLayout.encode(rawState, tlvData, 4);

            expect(MintCloseAuthorityLayout.decode(tlvData, 4)).to.eql(rawState);
            expect(getMintCloseAuthority({ tlvData } as Mint)).to.eql({ closeAuthority });
        });
    }

    it('returns null when the extension is absent', () => {
        expect(getMintCloseAuthority({ tlvData: Buffer.alloc(0) } as Mint)).to.equal(null);
    });
});

describe('permanent delegate state', () => {
    const presentDelegate = PublicKey.unique();

    for (const delegate of [presentDelegate, null]) {
        it(`decodes ${delegate ? 'present' : 'absent'} delegate`, () => {
            const rawState = {
                delegate: delegate ?? PublicKey.default,
            };
            const tlvData = Buffer.alloc(4 + PermanentDelegateLayout.span);
            tlvData.writeUInt16LE(ExtensionType.PermanentDelegate, 0);
            tlvData.writeUInt16LE(PermanentDelegateLayout.span, 2);
            PermanentDelegateLayout.encode(rawState, tlvData, 4);

            expect(PermanentDelegateLayout.decode(tlvData, 4)).to.eql(rawState);
            expect(getPermanentDelegate({ tlvData } as Mint)).to.eql({ delegate });
        });
    }

    it('returns null when the extension is absent', () => {
        expect(getPermanentDelegate({ tlvData: Buffer.alloc(0) } as Mint)).to.equal(null);
    });
});
