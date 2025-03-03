import test from 'ava';
import type {
  GetAccountInfoApi,
  Lamports,
  Rpc,
  Base64EncodedBytes,
  Commitment,
  UnixTimestamp,
  ReadonlyUint8Array,
} from '@solana/kit';
import { address, Address, getBase64Decoder } from '@solana/kit';
import { getSysvarClockEncoder, SYSVAR_CLOCK_ADDRESS } from '@solana/sysvars';
import {
  amountToUiAmountForMintWithoutSimulation,
  uiAmountToAmountForMintWithoutSimulation,
  TOKEN_2022_PROGRAM_ADDRESS,
  getMintEncoder,
} from '../../../src';

const ONE_YEAR_IN_SECONDS = 31556736;

type AccountInfo = Readonly<{
  executable: boolean;
  lamports: Lamports;
  owner: Address;
  rentEpoch: bigint;
  data: ReadonlyUint8Array;
}>;

function getMockRpc(
  accounts: Record<Address, AccountInfo>
): Rpc<GetAccountInfoApi> {
  const getAccountInfo = (
    address: Address,
    _config?: { commitment?: Commitment }
  ) => {
    const account = accounts[address];
    if (!account) {
      throw new Error(`Account not found for address: ${address}`);
    }
    if (!(account.data instanceof Uint8Array)) {
      throw new Error(
        `Account data is not a Uint8Array for address: ${address}`
      );
    }
    return {
      send: async () => ({
        context: { slot: 0n },
        value: account
          ? {
              executable: account.executable,
              lamports: account.lamports,
              owner: account.owner,
              rentEpoch: account.rentEpoch,
              data: [getBase64Decoder().decode(account.data), 'base64'] as [
                Base64EncodedBytes,
                'base64',
              ],
            }
          : null,
      }),
    };
  };
  return { getAccountInfo } as unknown as Rpc<GetAccountInfoApi>;
}

function populateMockAccount(data: ReadonlyUint8Array) {
  return {
    executable: false,
    lamports: 1000000n as Lamports,
    owner: TOKEN_2022_PROGRAM_ADDRESS,
    rentEpoch: 0n,
    data,
  };
}

function createMockMintAccountInfo(
  decimals = 2,
  hasInterestBearingConfig = false,
  config: { preUpdateAverageRate?: number; currentRate?: number } = {}
) {
  const defaultAddress = address('11111111111111111111111111111111');
  const mintEncoder = getMintEncoder();

  const data = mintEncoder.encode({
    mintAuthority: defaultAddress,
    supply: BigInt(1000000),
    decimals: decimals,
    isInitialized: true,
    freezeAuthority: defaultAddress,
    extensions: hasInterestBearingConfig
      ? [
          {
            __kind: 'InterestBearingConfig',
            rateAuthority: defaultAddress,
            initializationTimestamp: BigInt(0),
            preUpdateAverageRate: config.preUpdateAverageRate || 500,
            lastUpdateTimestamp: BigInt(ONE_YEAR_IN_SECONDS),
            currentRate: config.currentRate || 500,
          },
        ]
      : [],
  });
  return populateMockAccount(data);
}

const createMockClockAccountInfo = (unixTimestamp: number) => {
  const clockEncoder = getSysvarClockEncoder();
  const data = clockEncoder.encode({
    epoch: 0n,
    epochStartTimestamp: BigInt(0) as UnixTimestamp,
    leaderScheduleEpoch: 0n,
    slot: 0n,
    unixTimestamp: BigInt(unixTimestamp) as UnixTimestamp,
  });
  return populateMockAccount(data);
};

const mint = address('So11111111111111111111111111111111111111112');
const clock = SYSVAR_CLOCK_ADDRESS;

test('should return the correct UiAmount when interest bearing config is not present', async (t) => {
  const testCases = [
    { decimals: 0, amount: BigInt(100), expected: '100' },
    { decimals: 2, amount: BigInt(100), expected: '1' },
    { decimals: 9, amount: BigInt(1000000000), expected: '1' },
    { decimals: 10, amount: BigInt(1), expected: '1e-10' },
    { decimals: 10, amount: BigInt(1000000000), expected: '0.1' },
  ];

  for (const { decimals, amount, expected } of testCases) {
    const rpc = getMockRpc({
      [clock]: createMockClockAccountInfo(ONE_YEAR_IN_SECONDS),
      [mint]: createMockMintAccountInfo(decimals, false),
    });
    const result = await amountToUiAmountForMintWithoutSimulation(
      rpc,
      mint,
      amount
    );
    t.is(result, expected);
  }
});

test('should return the correct UiAmount for constant 5% rate', async (t) => {
  const testCases = [
    { decimals: 0, amount: BigInt(1), expected: '1' },
    { decimals: 1, amount: BigInt(1), expected: '0.1' },
    { decimals: 10, amount: BigInt(1), expected: '1e-10' },
    { decimals: 10, amount: BigInt(10000000000), expected: '1.0512710963' },
  ];

  for (const { decimals, amount, expected } of testCases) {
    const rpc = getMockRpc({
      [clock]: createMockClockAccountInfo(ONE_YEAR_IN_SECONDS),
      [mint]: createMockMintAccountInfo(decimals, true),
    });

    const result = await amountToUiAmountForMintWithoutSimulation(
      rpc,
      mint,
      amount
    );
    t.is(result, expected);
  }
});

test('should return the correct UiAmount for constant -5% rate', async (t) => {
  const rpc = getMockRpc({
    [clock]: createMockClockAccountInfo(ONE_YEAR_IN_SECONDS),
    [mint]: createMockMintAccountInfo(10, true, {
      preUpdateAverageRate: -500,
      currentRate: -500,
    }),
  });

  const result = await amountToUiAmountForMintWithoutSimulation(
    rpc,
    mint,
    BigInt(10000000000)
  );
  t.is(result, '0.9512294245');
});

test('should return the correct UiAmount for netting out rates', async (t) => {
  const rpc = getMockRpc({
    [clock]: createMockClockAccountInfo(ONE_YEAR_IN_SECONDS * 2),
    [mint]: createMockMintAccountInfo(10, true, {
      preUpdateAverageRate: -500,
      currentRate: 500,
    }),
  });

  const result = await amountToUiAmountForMintWithoutSimulation(
    rpc,
    mint,
    BigInt(10000000000)
  );
  t.is(result, '1');
});

test('should handle huge values correctly', async (t) => {
  const rpc = getMockRpc({
    [clock]: createMockClockAccountInfo(ONE_YEAR_IN_SECONDS * 2),
    [mint]: createMockMintAccountInfo(6, true),
  });

  const result = await amountToUiAmountForMintWithoutSimulation(
    rpc,
    mint,
    BigInt('18446744073709551615')
  );
  t.is(result, '20386805083448.098');
});

test('should return the correct amount for constant 5% rate', async (t) => {
  const rpc = getMockRpc({
    [clock]: createMockClockAccountInfo(ONE_YEAR_IN_SECONDS),
    [mint]: createMockMintAccountInfo(0, true),
  });

  const result = await uiAmountToAmountForMintWithoutSimulation(
    rpc,
    mint,
    '1.0512710963760241'
  );
  t.is(result, 1n);
});

test('should handle decimal places correctly', async (t) => {
  const testCases = [
    { decimals: 1, uiAmount: '0.10512710963760241', expected: 1n },
    { decimals: 10, uiAmount: '0.00000000010512710963760242', expected: 1n },
    { decimals: 10, uiAmount: '1.0512710963760241', expected: 10000000000n },
  ];

  for (const { decimals, uiAmount, expected } of testCases) {
    const rpc = getMockRpc({
      [clock]: createMockClockAccountInfo(ONE_YEAR_IN_SECONDS),
      [mint]: createMockMintAccountInfo(decimals, true),
    });

    const result = await uiAmountToAmountForMintWithoutSimulation(
      rpc,
      mint,
      uiAmount
    );
    t.is(result, expected);
  }
});

test('should return the correct amount for constant -5% rate', async (t) => {
  const rpc = getMockRpc({
    [clock]: createMockClockAccountInfo(ONE_YEAR_IN_SECONDS),
    [mint]: createMockMintAccountInfo(10, true, {
      preUpdateAverageRate: -500,
      currentRate: -500,
    }),
  });

  const result = await uiAmountToAmountForMintWithoutSimulation(
    rpc,
    mint,
    '0.951229424500714'
  );
  t.is(result, 9999999999n); // calculation truncates to avoid floating point precision issues in transfers
});

test('should return the correct amount for netting out rates', async (t) => {
  const rpc = getMockRpc({
    [clock]: createMockClockAccountInfo(ONE_YEAR_IN_SECONDS * 2),
    [mint]: createMockMintAccountInfo(10, true, {
      preUpdateAverageRate: -500,
      currentRate: 500,
    }),
  });

  const result = await uiAmountToAmountForMintWithoutSimulation(rpc, mint, '1');
  t.is(result, 10000000000n);
});

test('should handle huge values correctly for amount to ui amount', async (t) => {
  const rpc = getMockRpc({
    [clock]: createMockClockAccountInfo(ONE_YEAR_IN_SECONDS * 2),
    [mint]: createMockMintAccountInfo(0, true),
  });

  const result = await uiAmountToAmountForMintWithoutSimulation(
    rpc,
    mint,
    '20386805083448100000'
  );
  t.is(result, 18446744073709551616n);
});
