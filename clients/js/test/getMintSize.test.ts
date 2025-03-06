import test from 'ava';

import { extension, getMintSize } from '../src';
import { address } from '@solana/kit';

test('it returns the base size when no extensions are provided', (t) => {
  t.is(getMintSize(), 82 /* base size */);
});

test('it returns the extended base size when an empty array of extensions is provided', (t) => {
  t.is(
    getMintSize([]),
    82 /* base size */ +
      83 /* offset to reach 165 */ +
      1 /* mint discriminator */
  );
});

test('it returns the size including all provided extensions', (t) => {
  t.is(
    getMintSize([
      extension('MintCloseAuthority', {
        closeAuthority: address('HHS1XymmkBpYAkg3XTbZLxgHa5n11PAWUCWdiVtRmzzS'),
      }),
      extension('TransferHook', {
        authority: address('6YG6ggAzLnqu1oV56HELbmvfyveD3JKmCmEWGU9W6RK2'),
        programId: address('DAFy5fcNXoaxxrtenLrqH1DHUyD8rAqn77sDMEHit4Qx'),
      }),
    ]),
    166 /* extended mint base size */ +
      36 /* MintCloseAuthority extension size */ +
      68 /* TransferHook extension size */
  );
});
