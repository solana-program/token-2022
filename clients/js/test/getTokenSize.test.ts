import test from 'ava';

import { extension, getTokenSize } from '../src';

test('it returns the base size when no extensions are provided', (t) => {
  t.is(getTokenSize(), 165 /* base size */);
});

test('it returns the extended base size when an empty array of extensions is provided', (t) => {
  t.is(getTokenSize([]), 165 /* base size */ + 1 /* token discriminator */);
});

test('it returns the size including all provided extensions', (t) => {
  t.is(
    getTokenSize([
      extension('ImmutableOwner', {}),
      extension('TransferFeeAmount', { withheldAmount: 100n }),
    ]),
    166 /* extended mint base size */ +
      4 /* ImmutableOwner extension size */ +
      12 /* TransferFeeAmount extension size */
  );
});
