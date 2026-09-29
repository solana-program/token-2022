import { PublicKey } from '@solana/web3.js';
import { expect } from 'chai';
import type { Mint } from '../../src';
import { ExtensionType, getScaledUiAmountConfig, ScaledUiAmountConfigLayout } from '../../src';

describe('Scaled UI amount config', () => {
    for (const authority of [PublicKey.unique(), PublicKey.default]) {
        it(`decodes ${authority.equals(PublicKey.default) ? 'absent' : 'present'} authority`, () => {
            const config = {
                authority,
                multiplier: 1.5,
                newMultiplierEffectiveTimestamp: 1000n,
                newMultiplier: 2.5,
            };
            const tlvData = Buffer.alloc(4 + ScaledUiAmountConfigLayout.span);
            tlvData.writeUInt16LE(ExtensionType.ScaledUiAmountConfig, 0);
            tlvData.writeUInt16LE(ScaledUiAmountConfigLayout.span, 2);
            ScaledUiAmountConfigLayout.encode(config, tlvData, 4);

            expect(getScaledUiAmountConfig({ tlvData } as Mint)).to.deep.equal({
                ...config,
                authority: authority.equals(PublicKey.default) ? null : authority,
            });
        });
    }

    it('returns null when the extension is absent', () => {
        expect(getScaledUiAmountConfig({ tlvData: Buffer.alloc(0) } as Mint)).to.equal(null);
    });
});
