import { address, getBase16Encoder, getBase64Encoder, none, some } from '@solana/kit';
import { expect, it } from 'vitest';

import { AccountState, Token, getTokenDecoder, getTokenEncoder } from '../../src';

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
// require (e.g. `InitializeAccount3` only checks `required <= actual`). The
// unused tail is filled with `Uninitialized` TLV entries, each of which is
// `type(2) + length(2) = 4` bytes on chain. The decoder must consume that tail
// via its `remainder` extension array, so any number of free bytes that is a
// multiple of 4 must decode cleanly rather than throwing.
it.each([
    [0, 0],
    [4, 1],
    [8, 2],
    [12, 3],
])('decodes a token account with %i bytes of unused extension space', (freeBytes, paddingEntries) => {
    // Given a base token account followed by an unused extension region.
    const base = getTokenEncoder().encode({
        mint: address('5gSwsLGzyCwgwPJSnxjsQCaFeE19ZFaibHMLky9TDFim'),
        owner: address('FdrdFuo1RQ9LrQ3FRfQUE7RigyANe5kFNLyMhCYk1xgJ'),
        amount: 0n,
        delegate: none(),
        state: AccountState.Initialized,
        isNative: none(),
        delegatedAmount: 0n,
        closeAuthority: none(),
        extensions: some([]),
    });
    const data = new Uint8Array(base.length + freeBytes);
    data.set(base, 0);

    // When we decode it, then it does not throw and the unused region is read as
    // `Uninitialized` padding entries, one per 4-byte TLV header.
    const decodedData = getTokenDecoder().decode(data);
    expect(decodedData.extensions).toStrictEqual(
        some(Array.from({ length: paddingEntries }, () => ({ __kind: 'Uninitialized' }))),
    );
});
