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
const CLOCK = SYSVAR_CLOCK_ADDRESS;
const mint = address('So11111111111111111111111111111111111111112');

// Helper functions
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
  hasScaledUiAmountConfig = false,
  config: {
    multiplier?: number;
    newMultiplier?: number;
    newMultiplierEffectiveTimestamp?: number;
  } = {}
) {
  const defaultAddress = address('11111111111111111111111111111111');
  const mintEncoder = getMintEncoder();

  const data = mintEncoder.encode({
    mintAuthority: defaultAddress,
    supply: BigInt(1000000),
    decimals: decimals,
    isInitialized: true,
    freezeAuthority: defaultAddress,
    extensions: hasScaledUiAmountConfig
      ? [
          {
            __kind: 'ScaledUiAmountConfig',
            authority: defaultAddress,
            multiplier: config.multiplier || 2,
            newMultiplierEffectiveTimestamp:
              config.newMultiplierEffectiveTimestamp || ONE_YEAR_IN_SECONDS * 3,
            newMultiplier: config.newMultiplier || 2,
          },
        ]
      : [],
  });
  return populateMockAccount(data);
}

function createMockClockAccountInfo(unixTimestamp: number) {
  const clockEncoder = getSysvarClockEncoder();
  const data = clockEncoder.encode({
    epoch: 0n,
    epochStartTimestamp: 0n as UnixTimestamp,
    leaderScheduleEpoch: 0n,
    slot: 0n,
    unixTimestamp: BigInt(unixTimestamp) as UnixTimestamp,
  });
  return populateMockAccount(data);
}

// GROUP 1: Basic functionality - standard mint without scaled UI extension
test('should return the correct UiAmount when scaled ui amount config is not present', async (t) => {
  const testCases = [
    { decimals: 0, amount: BigInt(100), expected: '100' },
    { decimals: 2, amount: BigInt(100), expected: '1' },
    { decimals: 9, amount: BigInt(1000000000), expected: '1' },
    { decimals: 10, amount: BigInt(1), expected: '1e-10' },
    { decimals: 10, amount: BigInt(1000000000), expected: '0.1' },
  ];

  for (const { decimals, amount, expected } of testCases) {
    const rpc = getMockRpc({
      [CLOCK]: createMockClockAccountInfo(ONE_YEAR_IN_SECONDS * 2),
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

// GROUP 2: Basic integer multiplier tests
test('should return the correct UiAmount with scale factor of 2', async (t) => {
  const testCases = [
    { decimals: 0, amount: BigInt(100), expected: '200' },
    { decimals: 1, amount: BigInt(100), expected: '20' },
    { decimals: 10, amount: BigInt(10000000000), expected: '2' },
  ];

  for (const { decimals, amount, expected } of testCases) {
    const rpc = getMockRpc({
      [CLOCK]: createMockClockAccountInfo(ONE_YEAR_IN_SECONDS * 2),
      [mint]: createMockMintAccountInfo(decimals, true, { multiplier: 2 }),
    });

    const result = await amountToUiAmountForMintWithoutSimulation(
      rpc,
      mint,
      amount
    );
    t.is(result, expected);
  }
});

test('should return the correct amount for different scale factors', async (t) => {
  const testCases = [
    {
      decimals: 0,
      multiplier: 2,
      uiAmount: '2',
      expected: 1n,
    },
    {
      decimals: 10,
      multiplier: 3,
      uiAmount: '3',
      expected: 10000000000n,
    },
  ];

  for (const { decimals, multiplier, uiAmount, expected } of testCases) {
    const rpc = getMockRpc({
      [CLOCK]: createMockClockAccountInfo(ONE_YEAR_IN_SECONDS * 2),
      [mint]: createMockMintAccountInfo(decimals, true, { multiplier }),
    });

    const result = await uiAmountToAmountForMintWithoutSimulation(
      rpc,
      mint,
      uiAmount
    );
    t.is(result, expected);
  }
});

// GROUP 3: Decimal multiplier tests
test('should handle decimal multipliers correctly', async (t) => {
  const testCases = [
    {
      decimals: 2,
      multiplier: 0.5,
      amount: BigInt(100),
      expected: '0.5',
    },
    {
      decimals: 2,
      multiplier: 1.5,
      amount: BigInt(100),
      expected: '1.5',
    },
    {
      decimals: 3,
      multiplier: 0.001,
      amount: BigInt(1000),
      expected: '0.001',
    },
  ];

  for (const { decimals, multiplier, amount, expected } of testCases) {
    const rpc = getMockRpc({
      [CLOCK]: createMockClockAccountInfo(ONE_YEAR_IN_SECONDS * 2),
      [mint]: createMockMintAccountInfo(decimals, true, { multiplier }),
    });

    const result = await amountToUiAmountForMintWithoutSimulation(
      rpc,
      mint,
      amount
    );
    t.is(result, expected);
  }
});

test('should convert UI amounts with decimal multipliers correctly', async (t) => {
  const testCases = [
    {
      multiplier: 0.5,
      uiAmount: '1',
      expected: 200n, // 1 * 100(for 2 decimals) / 0.5
    },
    {
      multiplier: 1.5,
      uiAmount: '3',
      expected: 200n, // 3 * 100(for 2 decimals) / 1.5
    },
  ];

  for (const { multiplier, uiAmount, expected } of testCases) {
    const rpc = getMockRpc({
      [CLOCK]: createMockClockAccountInfo(ONE_YEAR_IN_SECONDS * 2),
      [mint]: createMockMintAccountInfo(2, true, { multiplier }),
    });

    const result = await uiAmountToAmountForMintWithoutSimulation(
      rpc,
      mint,
      uiAmount
    );
    t.is(result, expected);
  }
});

// GROUP 4: Tests for handling new effective multipliers
test('should use new multiplier when timestamp is after effective timestamp', async (t) => {
  const rpc = getMockRpc({
    [CLOCK]: createMockClockAccountInfo(ONE_YEAR_IN_SECONDS * 2),
    [mint]: createMockMintAccountInfo(2, true, {
      multiplier: 2,
      newMultiplier: 3,
      newMultiplierEffectiveTimestamp: ONE_YEAR_IN_SECONDS,
    }),
  });

  const result = await amountToUiAmountForMintWithoutSimulation(
    rpc,
    mint,
    BigInt(100)
  );
  t.is(result, '3');
});

test('should use current multiplier when timestamp is before effective timestamp', async (t) => {
  const rpc = getMockRpc({
    [CLOCK]: createMockClockAccountInfo(ONE_YEAR_IN_SECONDS / 2),
    [mint]: createMockMintAccountInfo(2, true, {
      multiplier: 2,
      newMultiplier: 3,
      newMultiplierEffectiveTimestamp: ONE_YEAR_IN_SECONDS,
    }),
  });

  const result = await amountToUiAmountForMintWithoutSimulation(
    rpc,
    mint,
    BigInt(100)
  );
  t.is(result, '2');
});

test('should use new multiplier for amount to ui conversion when timestamp is after effective timestamp', async (t) => {
  // Mock clock to a time after the effective timestamp
  const rpc = getMockRpc({
    [CLOCK]: createMockClockAccountInfo(ONE_YEAR_IN_SECONDS * 2),
    [mint]: createMockMintAccountInfo(2, true, {
      multiplier: 2,
      newMultiplier: 4,
      newMultiplierEffectiveTimestamp: ONE_YEAR_IN_SECONDS,
    }),
  });

  const result = await uiAmountToAmountForMintWithoutSimulation(rpc, mint, '2');
  t.is(result, 50n); // 2 * 100(for 2 decimals) / 4
});

test('should use current multiplier for amount to ui conversion when timestamp is before effective timestamp', async (t) => {
  // Mock clock to a time before the effective timestamp
  const rpc = getMockRpc({
    [CLOCK]: createMockClockAccountInfo(ONE_YEAR_IN_SECONDS / 2),
    [mint]: createMockMintAccountInfo(2, true, {
      multiplier: 2,
      newMultiplier: 4,
      newMultiplierEffectiveTimestamp: ONE_YEAR_IN_SECONDS,
    }),
  });

  const result = await uiAmountToAmountForMintWithoutSimulation(rpc, mint, '2');
  t.is(result, 100n); // 2 * 100(for 2 decimals) / 2
});

// GROUP 5: Edge cases and large number handling
test('should handle decimal places correctly', async (t) => {
  const testCases = [
    { decimals: 1, uiAmount: '0.2', expected: 1n },
    { decimals: 10, uiAmount: '0.0000000002', expected: 1n },
    { decimals: 10, uiAmount: '10.0000000002', expected: 50000000001n },
  ];

  for (const { decimals, uiAmount, expected } of testCases) {
    const rpc = getMockRpc({
      [CLOCK]: createMockClockAccountInfo(ONE_YEAR_IN_SECONDS * 2),
      [mint]: createMockMintAccountInfo(decimals, true, { multiplier: 2 }),
    });

    const result = await uiAmountToAmountForMintWithoutSimulation(
      rpc,
      mint,
      uiAmount
    );
    t.is(result, expected);
  }
});

test('should handle huge values correctly', async (t) => {
  const rpc = getMockRpc({
    [CLOCK]: createMockClockAccountInfo(ONE_YEAR_IN_SECONDS * 2),
    [mint]: createMockMintAccountInfo(6, true, { multiplier: 2 }),
  });

  const result = await amountToUiAmountForMintWithoutSimulation(
    rpc,
    mint,
    BigInt('18446744073709551615')
  );
  t.is(result, '36893488147419.1');
});

test('should handle huge values correctly for amount to ui amount', async (t) => {
  const rpc = getMockRpc({
    [CLOCK]: createMockClockAccountInfo(ONE_YEAR_IN_SECONDS * 2),
    [mint]: createMockMintAccountInfo(0, true, { multiplier: 2 }),
  });

  const result = await uiAmountToAmountForMintWithoutSimulation(
    rpc,
    mint,
    '1844674407370955.16'
  );
  t.is(result, 922337203685477n);
});
