import { getBase64Encoder, none } from '@solana/web3.js';
import test from 'ava';
import { AccountState, Token, getTokenDecoder } from '../../src';

test('it decodes a token account with extensions', (t) => {
  // Given an encoded mega token account.
  const encodedData = getBase64Encoder().encode(
    'RYm8iq8LbcyTLQKCP6wVDptQOvkKvx/PFJtKgrZAeG7ZdKMso+RJvIY7btmT+8qNLoG5UbM+oYVSXTaPoAGscwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgcAAAANAAAAAgAIAAAAAAAAAAAADwABAAAIAAEAAQsAAQABBQAnAQHGmf+ACSBnwGhPwFsNLGf0R68ypIqgyJhY8PGmjul0JwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC1Oy+19D9M/Ln1h7jIkAZ9g7WaCs4m0zPkPZy7ew5I1hYEN5AEBAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAARAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='
  );

  // When we decode it.
  const decodedData = getTokenDecoder().decode(encodedData);
  console.log(decodedData);

  // Then we expect the following data.
  t.like(decodedData, <Token>{
    mint: '5gSwsLGzyCwgwPJSnxjsQCaFeE19ZFaibHMLky9TDFim',
    owner: 'FdrdFuo1RQ9LrQ3FRfQUE7RigyANe5kFNLyMhCYk1xgJ',
    amount: 0n,
    delegate: none(),
    state: AccountState.Initialized,
    isNative: none(),
    delegatedAmount: 0n,
    closeAuthority: none(),
    // extensions: [
    //   // {
    //   //   __kind: 'MintCloseAuthority',
    //   //   closeAuthority: 'FdrdFuo1RQ9LrQ3FRfQUE7RigyANe5kFNLyMhCYk1xgJ',
    //   // },
    // ],
  });
});
