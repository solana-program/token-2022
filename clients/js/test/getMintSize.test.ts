import { address } from '@solana/kit';
import { expect, it } from 'vitest';

import { AccountState, extension, getMintSize } from '../src';

it('returns the base size when no extensions are provided', () => {
    expect(getMintSize()).toBe(82 /* base size */);
});

it('returns the extended base size when an empty array of extensions is provided', () => {
    expect(getMintSize([])).toBe(82 /* base size */ + 83 /* offset to reach 165 */ + 1 /* mint discriminator */);
});

it('returns the size including all provided extensions', () => {
    expect(
        getMintSize([
            extension('MintCloseAuthority', {
                closeAuthority: address('HHS1XymmkBpYAkg3XTbZLxgHa5n11PAWUCWdiVtRmzzS'),
            }),
            extension('TransferHook', {
                authority: address('6YG6ggAzLnqu1oV56HELbmvfyveD3JKmCmEWGU9W6RK2'),
                programId: address('DAFy5fcNXoaxxrtenLrqH1DHUyD8rAqn77sDMEHit4Qx'),
            }),
        ]),
    ).toBe(
        166 /* extended mint base size */ +
            36 /* MintCloseAuthority extension size */ +
            68 /* TransferHook extension size */,
    );
});

it('returns the correct size for the confidential mint burn extension', () => {
    expect(
        getMintSize([
            extension('ConfidentialMintBurn', {
                confidentialSupply: new Uint8Array(64),
                decryptableSupply: new Uint8Array(36),
                supplyElgamalPubkey: address('6YG6ggAzLnqu1oV56HELbmvfyveD3JKmCmEWGU9W6RK2'),
                pendingBurn: new Uint8Array(64),
            }),
        ]),
    ).toBe(166 /* extended mint base size */ + 4 /* TLV header */ + 196 /* ConfidentialMintBurn extension size */);
});

it('adds padding when the size would equal the multisig account size', () => {
    const authority = address('6YG6ggAzLnqu1oV56HELbmvfyveD3JKmCmEWGU9W6RK2');
    const transferFee = { epoch: 0n, maximumFee: 0n, transferFeeBasisPoints: 0 };
    expect(
        getMintSize([
            extension('TransferFeeConfig', {
                transferFeeConfigAuthority: authority,
                withdrawWithheldAuthority: authority,
                withheldAmount: 0n,
                olderTransferFee: transferFee,
                newerTransferFee: transferFee,
            }),
            extension('TransferHook', { authority, programId: authority }),
            extension('DefaultAccountState', { state: AccountState.Initialized }),
            extension('NonTransferable', {}),
        ]),
    ).toBe(
        166 /* extended mint base size */ +
            112 /* TransferFeeConfig extension size */ +
            68 /* TransferHook extension size */ +
            5 /* DefaultAccountState extension size */ +
            4 /* NonTransferable extension size */ +
            2 /* padding so the size differs from the 355-byte multisig size */,
    );
});
