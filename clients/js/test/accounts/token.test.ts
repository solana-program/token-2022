import { address, getBase16Encoder, getBase64Encoder, none, some } from '@solana/kit';
import { expect, it } from 'vitest';

import { AccountState, type ExtensionArgs, Token, getTokenDecoder, getTokenEncoder } from '../../src';

it('decodes a token account with extensions', () => {
    // Given an encoded mega token account.
    const encodedData = getBase64Encoder().encode(
        'RYm8iq8LbcyTLQKCP6wVDptQOvkKvx/PFJtKgrZAeG7ZdKMso+RJvIY7btmT+8qNLoG5UbM+oYVSXTaPoAGscwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgcAAAANAAAAAgAIAAAAAAAAAAAADwABAAAIAAEAAQsAAQABBQAnAQHGmf+ACSBnwGhPwFsNLGf0R68ypIqgyJhY8PGmjul0JwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC1Oy+19D9M/Ln1h7jIkAZ9g7WaCs4m0zPkPZy7ew5I1hYEN5AEBAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAARAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
    );

    // When we decode it.
    const decodedData = getTokenDecoder().decode(encodedData);

    // Then we expect the following data.
    expect(decodedData).toMatchObject(<Token>{
        mint: '5gSwsLGzyCwgwPJSnxjsQCaFeE19ZFaibHMLky9TDFim',
        owner: 'FdrdFuo1RQ9LrQ3FRfQUE7RigyANe5kFNLyMhCYk1xgJ',
        amount: 0n,
        delegate: none(),
        state: AccountState.Initialized,
        isNative: none(),
        delegatedAmount: 0n,
        closeAuthority: none(),
        extensions: some([
            { __kind: 'ImmutableOwner' },
            { __kind: 'NonTransferableAccount' },
            { __kind: 'TransferFeeAmount', withheldAmount: 0n },
            { __kind: 'TransferHookAccount', transferring: false },
            { __kind: 'MemoTransfer', requireIncomingTransferMemos: true },
            { __kind: 'CpiGuard', lockCpi: true },
            {
                __kind: 'ConfidentialTransferAccount',
                approved: true,
                elgamalPubkey: 'ENFvQcBnPT599PsYBcKwa8wRFiyWcDYiELvZ7bdvQWPp',
                pendingBalanceLow: new Uint8Array(64).fill(0),
                pendingBalanceHigh: new Uint8Array(64).fill(0),
                availableBalance: new Uint8Array(64).fill(0),
                decryptableAvailableBalance: getBase16Encoder().encode(
                    '2d4ecbed7d0fd33f2e7d61ee3224019f60ed6682b389b4ccf90f672edec3923585810de4',
                ),
                allowConfidentialCredits: true,
                allowNonConfidentialCredits: true,
                pendingBalanceCreditCounter: 0n,
                maximumPendingBalanceCreditCounter: 65536n,
                expectedPendingBalanceCreditCounter: 0n,
                actualPendingBalanceCreditCounter: 0n,
            },
            {
                __kind: 'ConfidentialTransferFeeAmount',
                withheldAmount: new Uint8Array(64).fill(0),
            },
        ]),
    });
});

// Token accounts can legally be allocated with more space than their extensions
// require (e.g. `InitializeAccount3` only checks `required <= actual`, and the
// program pads accounts by 2 bytes when they would otherwise be the size of a
// multisig). The program stops reading the TLV region at the first `Uninitialized`
// (type 0) header or when fewer than 2 bytes remain, so the unused tail can have
// any length. The decoder must mirror that and never surface the padding.
const encodeTokenWithUnusedSpace = (extensions: ExtensionArgs[], freeBytes: number) => {
    const base = getTokenEncoder().encode({
        mint: address('5gSwsLGzyCwgwPJSnxjsQCaFeE19ZFaibHMLky9TDFim'),
        owner: address('FdrdFuo1RQ9LrQ3FRfQUE7RigyANe5kFNLyMhCYk1xgJ'),
        amount: 0n,
        delegate: none(),
        state: AccountState.Initialized,
        isNative: none(),
        delegatedAmount: 0n,
        closeAuthority: none(),
        extensions: some(extensions),
    });
    const data = new Uint8Array(base.length + freeBytes);
    data.set(base, 0);
    return data;
};

it.each([1, 2, 5, 6, 8])('decodes a token account with no extensions and %i bytes of unused space', freeBytes => {
    // Given a token account whose extension region is entirely unused.
    const data = encodeTokenWithUnusedSpace([], freeBytes);

    // When we decode it, then it does not throw and no extensions are reported.
    const decodedData = getTokenDecoder().decode(data);
    expect(decodedData.extensions).toStrictEqual(some([]));
});

it.each([1, 2, 5, 6, 8])('decodes a token account with extensions followed by %i bytes of unused space', freeBytes => {
    // Given a token account with real extensions followed by unused space.
    const extensions: ExtensionArgs[] = [
        { __kind: 'ImmutableOwner' },
        { __kind: 'TransferFeeAmount', withheldAmount: 42n },
    ];
    const data = encodeTokenWithUnusedSpace(extensions, freeBytes);

    // When we decode it, then only the real extensions are reported.
    const decodedData = getTokenDecoder().decode(data);
    expect(decodedData.extensions).toStrictEqual(some(extensions));
});

it('decodes the minimal account shape from issue #1448', () => {
    // Given a bare token account with a single trailing byte of unused space:
    // 165 base bytes, the account type byte, and one byte that cannot hold a TLV header.
    const data = new Uint8Array(165 + 1 + 1);
    data[165] = 2; // AccountType::Account

    // When we decode it, then it does not throw and no extensions are reported.
    const decodedData = getTokenDecoder().decode(data);
    expect(decodedData.extensions).toStrictEqual(some([]));
});
