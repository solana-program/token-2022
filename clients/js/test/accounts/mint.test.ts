import { getBase64Encoder, none, some } from '@solana/kit';
import test from 'ava';
import { AccountState, Mint, getMintDecoder } from '../../src';

test('it decodes a mint account with extensions', (t) => {
  // Given an encoded mega mint account.
  const encodedData = getBase64Encoder().encode(
    'AQAAANl0oyyj5Em8hjtu2ZP7yo0ugblRsz6hhVJdNo+gAaxzAAAAAAAAAAAJAQEAAADZdKMso+RJvIY7btmT+8qNLoG5UbM+oYVSXTaPoAGscwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQMAIADZdKMso+RJvIY7btmT+8qNLoG5UbM+oYVSXTaPoAGscwwAIADZdKMso+RJvIY7btmT+8qNLoG5UbM+oYVSXTaPoAGscwoANADZdKMso+RJvIY7btmT+8qNLoG5UbM+oYVSXTaPoAGsc1DcOGYAAAAABQBQ3DhmAAAAAAUACQAAAAYAAQABAQBsANl0oyyj5Em8hjtu2ZP7yo0ugblRsz6hhVJdNo+gAaxz2XSjLKPkSbyGO27Zk/vKjS6BuVGzPqGFUl02j6ABrHMAAAAAAAAAAAAAAAAAAAAACwAAAAAAAAAKAAAAAAAAAAAACwAAAAAAAAAKAAQAQQDZdKMso+RJvIY7btmT+8qNLoG5UbM+oYVSXTaPoAGscwEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAgQDZdKMso+RJvIY7btmT+8qNLoG5UbM+oYVSXTaPoAGsc8aZ/4AJIGfAaE/AWw0sZ/RHrzKkiqDImFjw8aaO6XQnAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAEAA2XSjLKPkSbyGO27Zk/vKjS6BuVGzPqGFUl02j6ABrHNFibyKrwttzJMtAoI/rBUOm1A6+Qq/H88Um0qCtkB4bhIAQADZdKMso+RJvIY7btmT+8qNLoG5UbM+oYVSXTaPoAGsc0WJvIqvC23Mky0Cgj+sFQ6bUDr5Cr8fzxSbSoK2QHhuFABAANl0oyyj5Em8hjtu2ZP7yo0ugblRsz6hhVJdNo+gAaxzRYm8iq8LbcyTLQKCP6wVDptQOvkKvx/PFJtKgrZAeG4WAEAA2XSjLKPkSbyGO27Zk/vKjS6BuVGzPqGFUl02j6ABrHNFibyKrwttzJMtAoI/rBUOm1A6+Qq/H88Um0qCtkB4bhMAjQDZdKMso+RJvIY7btmT+8qNLoG5UbM+oYVSXTaPoAGsc0WJvIqvC23Mky0Cgj+sFQ6bUDr5Cr8fzxSbSoK2QHhuCQAAAE1lZ2FUb2tlbgIAAABNVCEAAABodHRwczovL3NwbC5zb2xhbmEuY29tL3Rva2VuLTIwMjIBAAAABAAAAE1lZ2EFAAAAVG9rZW4VAFAA2XSjLKPkSbyGO27Zk/vKjS6BuVGzPqGFUl02j6ABrHNFibyKrwttzJMtAoI/rBUOm1A6+Qq/H88Um0qCtkB4bgAAAAAAAAAA6AMAAAAAAAA='
  );

  // When we decode it.
  const decodedData = getMintDecoder().decode(encodedData);

  // Then we expect the following data.
  t.like(decodedData, <Mint>{
    mintAuthority: some('FdrdFuo1RQ9LrQ3FRfQUE7RigyANe5kFNLyMhCYk1xgJ'),
    supply: 0n,
    decimals: 9,
    isInitialized: true,
    freezeAuthority: some('FdrdFuo1RQ9LrQ3FRfQUE7RigyANe5kFNLyMhCYk1xgJ'),
    extensions: some([
      {
        __kind: 'MintCloseAuthority',
        closeAuthority: 'FdrdFuo1RQ9LrQ3FRfQUE7RigyANe5kFNLyMhCYk1xgJ',
      },
      {
        __kind: 'PermanentDelegate',
        delegate: 'FdrdFuo1RQ9LrQ3FRfQUE7RigyANe5kFNLyMhCYk1xgJ',
      },
      {
        __kind: 'InterestBearingConfig',
        rateAuthority: 'FdrdFuo1RQ9LrQ3FRfQUE7RigyANe5kFNLyMhCYk1xgJ',
        initializationTimestamp: 1715002448n,
        preUpdateAverageRate: 5,
        lastUpdateTimestamp: 1715002448n,
        currentRate: 5,
      },
      { __kind: 'NonTransferable' },
      { __kind: 'DefaultAccountState', state: AccountState.Initialized },
      {
        __kind: 'TransferFeeConfig',
        transferFeeConfigAuthority:
          'FdrdFuo1RQ9LrQ3FRfQUE7RigyANe5kFNLyMhCYk1xgJ',
        withdrawWithheldAuthority:
          'FdrdFuo1RQ9LrQ3FRfQUE7RigyANe5kFNLyMhCYk1xgJ',
        withheldAmount: 0n,
        olderTransferFee: {
          epoch: 0n,
          maximumFee: 11n,
          transferFeeBasisPoints: 10,
        },
        newerTransferFee: {
          epoch: 0n,
          maximumFee: 11n,
          transferFeeBasisPoints: 10,
        },
      },
      {
        __kind: 'ConfidentialTransferMint',
        authority: some('FdrdFuo1RQ9LrQ3FRfQUE7RigyANe5kFNLyMhCYk1xgJ'),
        autoApproveNewAccounts: true,
        auditorElgamalPubkey: none(),
      },
      {
        __kind: 'ConfidentialTransferFee',
        authority: some('FdrdFuo1RQ9LrQ3FRfQUE7RigyANe5kFNLyMhCYk1xgJ'),
        elgamalPubkey: 'ENFvQcBnPT599PsYBcKwa8wRFiyWcDYiELvZ7bdvQWPp',
        harvestToMintEnabled: true,
        withheldAmount: new Uint8Array(64).fill(0),
      },
      {
        __kind: 'TransferHook',
        authority: 'FdrdFuo1RQ9LrQ3FRfQUE7RigyANe5kFNLyMhCYk1xgJ',
        programId: '5gSwsLGzyCwgwPJSnxjsQCaFeE19ZFaibHMLky9TDFim',
      },
      {
        __kind: 'MetadataPointer',
        authority: some('FdrdFuo1RQ9LrQ3FRfQUE7RigyANe5kFNLyMhCYk1xgJ'),
        metadataAddress: some('5gSwsLGzyCwgwPJSnxjsQCaFeE19ZFaibHMLky9TDFim'),
      },
      {
        __kind: 'GroupPointer',
        authority: some('FdrdFuo1RQ9LrQ3FRfQUE7RigyANe5kFNLyMhCYk1xgJ'),
        groupAddress: some('5gSwsLGzyCwgwPJSnxjsQCaFeE19ZFaibHMLky9TDFim'),
      },
      {
        __kind: 'GroupMemberPointer',
        authority: some('FdrdFuo1RQ9LrQ3FRfQUE7RigyANe5kFNLyMhCYk1xgJ'),
        memberAddress: some('5gSwsLGzyCwgwPJSnxjsQCaFeE19ZFaibHMLky9TDFim'),
      },
      {
        __kind: 'TokenMetadata',
        updateAuthority: some('FdrdFuo1RQ9LrQ3FRfQUE7RigyANe5kFNLyMhCYk1xgJ'),
        mint: '5gSwsLGzyCwgwPJSnxjsQCaFeE19ZFaibHMLky9TDFim',
        name: 'MegaToken',
        symbol: 'MT',
        uri: 'https://spl.solana.com/token-2022',
        additionalMetadata: new Map([['Mega', 'Token']]),
      },
      {
        __kind: 'TokenGroup',
        updateAuthority: some('FdrdFuo1RQ9LrQ3FRfQUE7RigyANe5kFNLyMhCYk1xgJ'),
        mint: '5gSwsLGzyCwgwPJSnxjsQCaFeE19ZFaibHMLky9TDFim',
        size: 0n,
        maxSize: 1000n,
      },
    ]),
  });
});
