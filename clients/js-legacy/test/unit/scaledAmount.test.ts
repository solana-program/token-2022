import { expect } from 'chai';
import type { Connection } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';
import {
    amountToUiAmountForMintWithoutSimulation,
    amountToUiAmountForScaledUiAmountMintWithoutSimulation,
    uiAmountToAmountForMintWithoutSimulation,
    uiAmountToAmountForScaledUiAmountMintWithoutSimulation,
} from '../../src/actions/amountToUiAmount';
import { AccountLayout, AccountType, ScaledUiAmountConfigLayout, TOKEN_2022_PROGRAM_ID } from '../../src';
import { MintLayout } from '../../src/state/mint';
import { ExtensionType } from '../../src/extensions/extensionType';

const ONE_YEAR_IN_SECONDS = 31556736;
const TEST_DECIMALS = 2;

// Mock connection class
class MockConnection {
    private mockAccountInfo: any;
    private mockClock: {
        epoch: number;
        epochStartTimestamp: number;
        leaderScheduleEpoch: number;
        slot: number;
        unixTimestamp: number;
    };

    constructor() {
        this.mockAccountInfo = null;
        this.mockClock = {
            epoch: 0,
            epochStartTimestamp: 0,
            leaderScheduleEpoch: 0,
            slot: 0,
            unixTimestamp: ONE_YEAR_IN_SECONDS,
        };
    }

    getAccountInfo = async (address: PublicKey) => {
        return this.getParsedAccountInfo(address);
    };

    // used to get the clock timestamp
    getParsedAccountInfo = async (address: PublicKey) => {
        if (address.toString() === 'SysvarC1ock11111111111111111111111111111111') {
            return {
                value: {
                    data: {
                        parsed: {
                            info: this.mockClock,
                        },
                    },
                },
            };
        }
        return this.mockAccountInfo;
    };

    setClockTimestamp(timestamp: number) {
        this.mockClock = {
            ...this.mockClock,
            unixTimestamp: timestamp,
        };
    }

    setAccountInfo(info: any) {
        this.mockAccountInfo = info;
    }
}

function createMockMintData(
    decimals = 2,
    hasScaledUiAmountConfig = false,
    config: { multiplier?: number; newMultiplier?: number; newMultiplierEffectiveTimestamp?: number } = {},
) {
    const mintData = Buffer.alloc(MintLayout.span);
    MintLayout.encode(
        {
            mintAuthorityOption: 1,
            mintAuthority: new PublicKey(new Uint8Array(32).fill(1)),
            supply: BigInt(1000000),
            decimals: decimals,
            isInitialized: true,
            freezeAuthorityOption: 1,
            freezeAuthority: new PublicKey(new Uint8Array(32).fill(1)),
        },
        mintData,
    );

    const baseData = Buffer.alloc(AccountLayout.span + 1);
    mintData.copy(baseData, 0);
    baseData[AccountLayout.span] = AccountType.Mint;

    if (!hasScaledUiAmountConfig) {
        return baseData;
    }

    // write extension data using the ScaledUiAmountConfigLayout
    const extensionData = Buffer.alloc(ScaledUiAmountConfigLayout.span);
    const rateAuthority = new Uint8Array(32).fill(1); // rate authority
    Buffer.from(rateAuthority).copy(extensionData, 0);
    extensionData.writeDoubleLE(config.multiplier || 0, 32); // multiplier (f64)
    extensionData.writeBigUInt64LE(BigInt(config.newMultiplierEffectiveTimestamp || ONE_YEAR_IN_SECONDS), 40); // new multiplier effective timestamp (u64)
    extensionData.writeDoubleLE(config.newMultiplier || 0, 48); // new multiplier (f64)

    const TYPE_SIZE = 2;
    const LENGTH_SIZE = 2;
    const tlvBuffer = Buffer.alloc(TYPE_SIZE + LENGTH_SIZE + extensionData.length);
    tlvBuffer.writeUInt16LE(ExtensionType.ScaledUiAmountConfig, 0);
    tlvBuffer.writeUInt16LE(extensionData.length, TYPE_SIZE);
    extensionData.copy(tlvBuffer, TYPE_SIZE + LENGTH_SIZE);

    const fullData = Buffer.alloc(baseData.length + tlvBuffer.length);
    baseData.copy(fullData, 0);
    tlvBuffer.copy(fullData, baseData.length);

    return fullData;
}

describe('Scaled UI Amount Extension', () => {
    let connection: MockConnection;
    const mint = new PublicKey('So11111111111111111111111111111111111111112');

    beforeEach(() => {
        connection = new MockConnection() as unknown as MockConnection;
    });

    describe('amountToUiAmountForScaledUiAmountMintWithoutSimulation', () => {
        it('should correctly scale amounts with different multipliers', () => {
            const testCases = [
                { amount: 100n, multiplier: 1, decimals: 2, expected: '1' },
                { amount: 100n, multiplier: 2, decimals: 2, expected: '2' },
                { amount: 100n, multiplier: 0.5, decimals: 2, expected: '0.5' },
                { amount: 1000000n, multiplier: 1.5, decimals: 6, expected: '1.5' },
            ];

            for (const { amount, multiplier, decimals, expected } of testCases) {
                const result = amountToUiAmountForScaledUiAmountMintWithoutSimulation(amount, decimals, multiplier);
                expect(result).to.equal(expected);
            }
        });

        it('should handle zero multiplier', () => {
            const result = amountToUiAmountForScaledUiAmountMintWithoutSimulation(100n, 2, 0);
            expect(result).to.equal('0');
        });

        it('should handle large numbers correctly', () => {
            const result = amountToUiAmountForScaledUiAmountMintWithoutSimulation(BigInt(10_000_000_000), 10, 5);
            expect(result).to.equal('5');
        });
    });

    describe('uiAmountToAmountForScaledUiAmountMintWithoutSimulation', () => {
        it('should correctly unscale amounts with different multipliers', () => {
            const testCases = [
                { uiAmount: '1', multiplier: 1, decimals: 2, expected: 100n },
                { uiAmount: '2', multiplier: 2, decimals: 2, expected: 100n },
                { uiAmount: '0.5', multiplier: 0.5, decimals: 2, expected: 100n },
                { uiAmount: '1.5', multiplier: 1.5, decimals: 6, expected: 1000000n },
            ];

            for (const { uiAmount, multiplier, decimals, expected } of testCases) {
                const result = uiAmountToAmountForScaledUiAmountMintWithoutSimulation(uiAmount, decimals, multiplier);
                expect(result).to.equal(expected);
            }
        });

        it('should handle zero multiplier', () => {
            expect(() => uiAmountToAmountForScaledUiAmountMintWithoutSimulation('1', 2, 0)).to.throw();
        });

        it('should handle large numbers correctly', () => {
            const result = uiAmountToAmountForScaledUiAmountMintWithoutSimulation('5.0000000000000000', 10, 5);
            expect(result).to.equal(10000000000n);
        });
    });

    describe('Integration with mint account', () => {
        it('should handle multiplier transition correctly', async () => {
            const currentTime = ONE_YEAR_IN_SECONDS;
            const futureTime = ONE_YEAR_IN_SECONDS * 2;

            connection.setAccountInfo({
                owner: TOKEN_2022_PROGRAM_ID,
                lamports: 1000000,
                data: createMockMintData(2, true, {
                    multiplier: 1,
                    newMultiplier: 2,
                    newMultiplierEffectiveTimestamp: futureTime,
                }),
            });

            // Test with current multiplier
            connection.setClockTimestamp(currentTime);
            let result = await amountToUiAmountForMintWithoutSimulation(
                connection as unknown as Connection,
                mint,
                100n,
            );
            expect(result).to.equal('1');

            // Test with new multiplier after effective timestamp
            connection.setClockTimestamp(futureTime);
            result = await amountToUiAmountForMintWithoutSimulation(connection as unknown as Connection, mint, 100n);
            expect(result).to.equal('2');
        });

        it('should correctly convert back and forth', async () => {
            connection.setAccountInfo({
                owner: TOKEN_2022_PROGRAM_ID,
                lamports: 1000000,
                data: createMockMintData(2, true, {
                    multiplier: 5,
                    newMultiplierEffectiveTimestamp: 0,
                    newMultiplier: 5,
                }),
            });

            const originalAmount = BigInt(100);
            const uiAmount = await amountToUiAmountForMintWithoutSimulation(
                connection as unknown as Connection,
                mint,
                originalAmount,
            );
            expect(uiAmount).to.equal('5');

            const convertedBack = await uiAmountToAmountForMintWithoutSimulation(
                connection as unknown as Connection,
                mint,
                uiAmount,
            );

            expect(convertedBack).to.equal(originalAmount);
        });

        it('should handle max values correctly', async () => {
            connection.setAccountInfo({
                owner: TOKEN_2022_PROGRAM_ID,
                lamports: 1000000,
                data: createMockMintData(0, true, {
                    multiplier: Number.MAX_VALUE,
                    newMultiplierEffectiveTimestamp: 0,
                    newMultiplier: Number.MAX_VALUE,
                }),
            });

            const result = await amountToUiAmountForMintWithoutSimulation(
                connection as unknown as Connection,
                mint,
                BigInt(Number.MAX_SAFE_INTEGER),
            );
            expect(result).to.equal('Infinity');
        });
    });
});
