import {
  type GetAccountInfoApi,
  type Rpc,
  Address,
  UnixTimestamp,
  unwrapOption,
} from '@solana/kit';
import { fetchSysvarClock } from '@solana/sysvars';
import { fetchMint } from './generated';

/**
 * Calculates the exponent for the interest rate formula.
 * @param t1 - The start time in seconds.
 * @param t2 - The end time in seconds.
 * @param r  - The interest rate in basis points.
 *
 * @returns The calculated exponent.
 */
function calculateExponentForTimesAndRate(t1: number, t2: number, r: number) {
  const ONE_IN_BASIS_POINTS = 10000;
  const SECONDS_PER_YEAR = 60 * 60 * 24 * 365.24;
  const timespan = t2 - t1;
  if (timespan < 0) {
    throw new Error('Invalid timespan: end time before start time');
  }

  const numerator = r * timespan;
  const exponent = numerator / (SECONDS_PER_YEAR * ONE_IN_BASIS_POINTS);
  return Math.exp(exponent);
}

/**
 * Calculates the total scale factor for an interest bearing token by combining two exponential functions:
 * One for the period between initialization and last update using the pre-update average rate,
 * and another for the period between last update and current time using the current rate.
 *
 * @param currentTimestamp         Current timestamp in seconds
 * @param lastUpdateTimestamp      Last time the interest rate was updated in seconds
 * @param initializationTimestamp  Time the interest bearing extension was initialized in seconds
 * @param preUpdateAverageRate     Interest rate in basis points before last update
 * @param currentRate              Current interest rate in basis points
 *
 * @returns The total scale factor as a product of the two exponential functions
 */
function calculateTotalScale({
  currentTimestamp,
  lastUpdateTimestamp,
  initializationTimestamp,
  preUpdateAverageRate,
  currentRate,
}: {
  currentTimestamp: number;
  lastUpdateTimestamp: number;
  initializationTimestamp: number;
  preUpdateAverageRate: number;
  currentRate: number;
}): number {
  // Calculate pre-update exponent
  // e^(preUpdateAverageRate * (lastUpdateTimestamp - initializationTimestamp) / (SECONDS_PER_YEAR * ONE_IN_BASIS_POINTS))
  const preUpdateExp = calculateExponentForTimesAndRate(
    initializationTimestamp,
    lastUpdateTimestamp,
    preUpdateAverageRate
  );

  // Calculate post-update exponent
  // e^(currentRate * (currentTimestamp - lastUpdateTimestamp) / (SECONDS_PER_YEAR * ONE_IN_BASIS_POINTS))
  const postUpdateExp = calculateExponentForTimesAndRate(
    lastUpdateTimestamp,
    currentTimestamp,
    currentRate
  );

  return preUpdateExp * postUpdateExp;
}

/**
 * Retrieves the current timestamp from the Solana clock sysvar.
 * @param rpc - The Solana rpc object.
 * @returns A promise that resolves to the current timestamp in seconds.
 * @throws An error if the sysvar clock cannot be fetched or parsed.
 */
async function getSysvarClockTimestamp(
  rpc: Rpc<GetAccountInfoApi>
): Promise<UnixTimestamp> {
  const info = await fetchSysvarClock(rpc);
  if (!info) {
    throw new Error('Failed to fetch sysvar clock');
  }
  return info.unixTimestamp;
}

/**
 * Convert amount to UiAmount for a mint with interest bearing extension without simulating a transaction
 * This implements the same logic as the CPI instruction available in /token/program-2022/src/extension/interest_bearing_mint/mod.rs
 * In general to calculate compounding interest over a period of time, the formula is:
 * A = P * e^(r * t) where
 * A = final amount after interest
 * P = principal amount (initial investment)
 * r = annual interest rate (as a decimal, e.g., 5% = 0.05)
 * t = time in years
 * e = mathematical constant (~2.718)
 *
 * In this case, we are calculating the total scale factor for the interest bearing extension which is the product of two exponential functions:
 * totalScale = e^(r1 * t1) * e^(r2 * t2)
 * where r1 and r2 are the interest rates before and after the last update, and t1 and t2 are the times in years between
 * the initialization timestamp and the last update timestamp, and between the last update timestamp and the current timestamp.
 *
 * @param amount                   Amount of tokens to be converted
 * @param decimals                 Number of decimals of the mint
 * @param currentTimestamp         Current timestamp in seconds
 * @param lastUpdateTimestamp      Last time the interest rate was updated in seconds
 * @param initializationTimestamp  Time the interest bearing extension was initialized in seconds
 * @param preUpdateAverageRate     Interest rate in basis points (1 basis point = 0.01%) before last update
 * @param currentRate              Current interest rate in basis points
 *
 * @return Amount scaled by accrued interest as a string with appropriate decimal places
 */
export function amountToUiAmountForInterestBearingMintWithoutSimulation(
  amount: bigint,
  decimals: number,
  currentTimestamp: number, // in seconds
  lastUpdateTimestamp: number,
  initializationTimestamp: number,
  preUpdateAverageRate: number,
  currentRate: number
): string {
  const totalScale = calculateTotalScale({
    currentTimestamp,
    lastUpdateTimestamp,
    initializationTimestamp,
    preUpdateAverageRate,
    currentRate,
  });
  // Scale the amount by the total interest factor
  const scaledAmount = Number(amount) * totalScale;

  // Calculate the decimal factor (e.g. 100 for 2 decimals)
  const decimalFactor = Math.pow(10, decimals);

  // Convert to UI amount by:
  // 1. Truncating to remove any remaining decimals
  // 2. Dividing by decimal factor to get final UI amount
  // 3. Converting to string
  return (Math.trunc(scaledAmount) / decimalFactor).toString();
}

/**
 * Convert amount to UiAmount for a mint without simulating a transaction
 * This implements the same logic as `process_amount_to_ui_amount` in
 * solana-labs/solana-program-library/token/program-2022/src/processor.rs
 * and `process_amount_to_ui_amount` in solana-labs/solana-program-library/token/program/src/processor.rs
 *
 * @param rpc     Rpc to use
 * @param mint    Mint to use for calculations
 * @param amount  Amount of tokens to be converted to Ui Amount
 *
 * @return Ui Amount generated
 */
export async function amountToUiAmountForMintWithoutSimulation(
  rpc: Rpc<GetAccountInfoApi>,
  mint: Address,
  amount: bigint
): Promise<string> {
  const accountInfo = await fetchMint(rpc, mint);
  const extensions = unwrapOption(accountInfo.data.extensions);
  const interestBearingMintConfigState = extensions?.find(
    (ext) => ext.__kind === 'InterestBearingConfig'
  );
  if (!interestBearingMintConfigState) {
    const amountNumber = Number(amount);
    const decimalsFactor = Math.pow(10, accountInfo.data.decimals);
    return (amountNumber / decimalsFactor).toString();
  }

  const timestamp = await getSysvarClockTimestamp(rpc);

  return amountToUiAmountForInterestBearingMintWithoutSimulation(
    amount,
    accountInfo.data.decimals,
    Number(timestamp),
    Number(interestBearingMintConfigState.lastUpdateTimestamp),
    Number(interestBearingMintConfigState.initializationTimestamp),
    interestBearingMintConfigState.preUpdateAverageRate,
    interestBearingMintConfigState.currentRate
  );
}

/**
 * Convert an amount with interest back to the original amount without interest
 * This implements the same logic as the CPI instruction available in /token/program-2022/src/extension/interest_bearing_mint/mod.rs
 *
 * @param uiAmount                  UI Amount (principal plus continuously compounding interest) to be converted back to original principal
 * @param decimals                  Number of decimals for the mint
 * @param currentTimestamp          Current timestamp in seconds
 * @param lastUpdateTimestamp       Last time the interest rate was updated in seconds
 * @param initializationTimestamp   Time the interest bearing extension was initialized in seconds
 * @param preUpdateAverageRate      Interest rate in basis points (hundredths of a percent) before the last update
 * @param currentRate              Current interest rate in basis points
 *
 * In general to calculate the principal from the UI amount, the formula is:
 * P = A / (e^(r * t)) where
 * P = principal
 * A = UI amount
 * r = annual interest rate (as a decimal, e.g., 5% = 0.05)
 * t = time in years
 *
 * In this case, we are calculating the principal by dividing the UI amount by the total scale factor which is the product of two exponential functions:
 * totalScale = e^(r1 * t1) * e^(r2 * t2)
 * where r1 is the pre-update average rate, r2 is the current rate, t1 is the time in years between the initialization timestamp and the last update timestamp,
 * and t2 is the time in years between the last update timestamp and the current timestamp.
 * then to calculate the principal, we divide the UI amount by the total scale factor:
 * P = A / totalScale
 *
 * @return Original amount (principal) without interest
 */
export function uiAmountToAmountForInterestBearingMintWithoutSimulation(
  uiAmount: string,
  decimals: number,
  currentTimestamp: number, // in seconds
  lastUpdateTimestamp: number,
  initializationTimestamp: number,
  preUpdateAverageRate: number,
  currentRate: number
): bigint {
  const uiAmountNumber = parseFloat(uiAmount);
  const decimalsFactor = Math.pow(10, decimals);
  const uiAmountScaled = uiAmountNumber * decimalsFactor;

  const totalScale = calculateTotalScale({
    currentTimestamp,
    lastUpdateTimestamp,
    initializationTimestamp,
    preUpdateAverageRate,
    currentRate,
  });

  // Calculate original principal by dividing the UI amount (principal + interest) by the total scale
  const originalPrincipal = uiAmountScaled / totalScale;
  return BigInt(Math.trunc(originalPrincipal));
}

/**
 * Convert a UI amount back to the raw amount
 *
 * @param rpc      Rpc to use
 * @param mint     Mint to use for calculations
 * @param uiAmount UI Amount to be converted back to raw amount
 *
 * @return Raw amount
 */
export async function uiAmountToAmountForMintWithoutSimulation(
  rpc: Rpc<GetAccountInfoApi>,
  mint: Address,
  uiAmount: string
): Promise<bigint> {
  const accountInfo = await fetchMint(rpc, mint);
  const extensions = unwrapOption(accountInfo.data.extensions);
  const interestBearingMintConfigState = extensions?.find(
    (ext) => ext.__kind === 'InterestBearingConfig'
  );
  if (!interestBearingMintConfigState) {
    const uiAmountScaled =
      parseFloat(uiAmount) * Math.pow(10, accountInfo.data.decimals);
    return BigInt(Math.trunc(uiAmountScaled));
  }

  const timestamp = await getSysvarClockTimestamp(rpc);

  return uiAmountToAmountForInterestBearingMintWithoutSimulation(
    uiAmount,
    accountInfo.data.decimals,
    Number(timestamp),
    Number(interestBearingMintConfigState.lastUpdateTimestamp),
    Number(interestBearingMintConfigState.initializationTimestamp),
    interestBearingMintConfigState.preUpdateAverageRate,
    interestBearingMintConfigState.currentRate
  );
}
