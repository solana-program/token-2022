import { expect, it } from 'vitest';
import { extension, getTokenSize } from '../src';

it('returns the base size when no extensions are provided', () => {
    expect(getTokenSize()).toBe(165 /* base size */);
});

it('returns the extended base size when an empty array of extensions is provided', () => {
    expect(getTokenSize([])).toBe(165 /* base size */ + 1 /* token discriminator */);
});

it('returns the size including all provided extensions', () => {
    expect(
        getTokenSize([extension('ImmutableOwner', {}), extension('TransferFeeAmount', { withheldAmount: 100n })]),
    ).toBe(
        166 /* extended token base size */ +
            4 /* ImmutableOwner extension size */ +
            12 /* TransferFeeAmount extension size */,
    );
});

it('returns the correct size for the pausable account extension', () => {
    expect(getTokenSize([extension('PausableAccount', {})])).toBe(
        166 /* extended token base size */ + 4 /* PausableAccount extension size */,
    );
});
