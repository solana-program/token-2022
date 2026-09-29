import { PublicKey } from '@solana/web3.js';
import { expect } from 'chai';
import type { Mint } from '../../src';
import { ExtensionType, getPausableConfig, PausableConfigLayout } from '../../src';

describe('Pausable config', () => {
    for (const authority of [PublicKey.unique(), PublicKey.default]) {
        it(`decodes ${authority.equals(PublicKey.default) ? 'absent' : 'present'} authority`, () => {
            const tlvData = Buffer.alloc(4 + PausableConfigLayout.span);
            tlvData.writeUInt16LE(ExtensionType.PausableConfig, 0);
            tlvData.writeUInt16LE(PausableConfigLayout.span, 2);
            PausableConfigLayout.encode({ authority, paused: true }, tlvData, 4);

            expect(getPausableConfig({ tlvData } as Mint)).to.deep.equal({
                authority: authority.equals(PublicKey.default) ? null : authority,
                paused: true,
            });
        });
    }

    it('returns null when the extension is absent', () => {
        expect(getPausableConfig({ tlvData: Buffer.alloc(0) } as Mint)).to.equal(null);
    });
});
