import { type GetAccountInfoApi, type Rpc, Address, UnixTimestamp, unwrapOption } from '@solana/kit';
import { fetchSysvarClock } from '@solana/sysvars';

import { fetchMint } from './generated';

// Constants
const ONE_IN_BASIS_POINTS = 10000;
const SECONDS_PER_YEAR = 60 * 60 * 24 * 365.24;

/**
 * Calculates the exponent for the interest rate formula.
 * @param t1 - The start time in seconds.
 * @param t2 - The end time in seconds.
 * @param r  - The interest rate in basis points.
 *
 * @returns The calculated exponent.
 */
function calculateExponentForTimesAndRate(t1: number, t2: number, r: number) {
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
    const preUpdateExp = calculateExponentForTimesAndRate(
        initializationTimestamp,
        lastUpdateTimestamp,
        preUpdateAverageRate,
    );

    // Calculate post-update exponent
    const postUpdateExp = calculateExponentForTimesAndRate(lastUpdateTimestamp, currentTimestamp, currentRate);

    return preUpdateExp * postUpdateExp;
}

/**
 * Calculates the decimal factor for a given number of decimals
 * @param decimals - Number of decimals
 * @returns The decimal factor (e.g., 100 for 2 decimals)
 */
function getDecimalFactor(decimals: number): number {
    return Math.pow(10, decimals);
}

const U64_MAX = 18446744073709551615n;

// Matches Rust's f64 grammar: optional sign, digits with optional fraction,
// optional exponent, or inf/infinity/nan.
const F64_STRING_PATTERN = /^[+-]?(?:inf(?:inity)?|nan|(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)$/i;

/**
 * Parses a UI amount string the way the program parses an `f64`.
 * @throws An error if the string is not a valid float representation.
 */
function parseUiAmountF64(uiAmount: string): number {
    if (!F64_STRING_PATTERN.test(uiAmount)) {
        throw new Error(`Invalid ui amount: ${uiAmount}`);
    }
    if (/inf/i.test(uiAmount)) {
        return uiAmount.startsWith('-') ? -Infinity : Infinity;
    }
    return Number(uiAmount);
}

/**
 * Trims trailing zeros and a dangling decimal point, mirroring the program's
 * `trim_ui_amount_string`.
 */
function trimUiAmountString(uiAmount: string, decimals: number): string {
    if (decimals > 0 && uiAmount.includes('.')) {
        return uiAmount.replace(/0+$/, '').replace(/\.$/, '');
    }
    return uiAmount;
}

/**
 * Formats a scaled f64 to `decimals` digits and trims, mirroring the
 * program's `format!("{scaled_amount:.*}", decimals)` followed by trimming.
 * Rounds half to even on the exact binary value of the double, like Rust,
 * which `toFixed` (round half up) does not.
 */
function formatUiAmountString(value: number, decimals: number): string {
    if (!Number.isFinite(value)) {
        return Number.isNaN(value) ? 'NaN' : value > 0 ? 'inf' : '-inf';
    }
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, Math.abs(value));
    const bits = view.getBigUint64(0);
    const biasedExponent = Number((bits >> 52n) & 0x7ffn);
    const fractionBits = bits & 0xfffffffffffffn;
    const mantissa = biasedExponent === 0 ? fractionBits : fractionBits | (1n << 52n);
    const exponent = (biasedExponent === 0 ? -1074 : biasedExponent - 1075) + 0;
    // |value| * 10^decimals as the exact fraction numerator/denominator
    let numerator = mantissa * 10n ** BigInt(decimals);
    let denominator = 1n;
    if (exponent >= 0) {
        numerator <<= BigInt(exponent);
    } else {
        denominator = 1n << BigInt(-exponent);
    }
    let quotient = numerator / denominator;
    const doubledRemainder = (numerator % denominator) * 2n;
    if (doubledRemainder > denominator || (doubledRemainder === denominator && (quotient & 1n) === 1n)) {
        quotient += 1n;
    }
    const sign = value < 0 && quotient > 0n ? '-' : '';
    if (decimals === 0) {
        return sign + quotient.toString();
    }
    const digits = quotient.toString().padStart(decimals + 1, '0');
    const fixed = `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
    return trimUiAmountString(fixed, decimals);
}

/**
 * Converts a raw token amount to a UI amount string exactly, mirroring the
 * program's `amount_to_ui_amount_string_trimmed`. Exact for the full u64
 * range, unlike float division.
 */
function amountToUiAmountStringTrimmed(amount: bigint, decimals: number): string {
    if (decimals === 0) {
        return amount.toString();
    }
    const digits = amount.toString().padStart(decimals + 1, '0');
    return trimUiAmountString(`${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`, decimals);
}

/**
 * Converts a UI amount string to a raw token amount exactly, mirroring the
 * program's `try_ui_amount_into_amount` for standard mints.
 * @throws An error if the string is malformed or out of the u64 range.
 */
function uiAmountStringToAmount(uiAmount: string, decimals: number): bigint {
    const parts = uiAmount.split('.');
    const fraction = (parts[1] ?? '').replace(/0+$/, '');
    if (parts.length > 2 || fraction.length > decimals) {
        throw new Error(`Invalid ui amount: ${uiAmount}`);
    }
    const digits = parts[0] + fraction + '0'.repeat(decimals - fraction.length);
    if (!/^\+?\d+$/.test(digits)) {
        throw new Error(`Invalid ui amount: ${uiAmount}`);
    }
    const amount = BigInt(digits.replace('+', ''));
    if (amount > U64_MAX) {
        throw new Error(`Invalid ui amount: ${uiAmount}`);
    }
    return amount;
}

/**
 * Range-checks and converts a scaled f64 back to a u64 amount, mirroring the
 * program's checks and its saturating `as u64` cast. `u64::MAX as f64` rounds
 * up to 2^64, so the check admits values the cast then saturates to u64::MAX.
 * @throws An error if the amount is negative, NaN or above the u64 range.
 */
function f64AmountToU64(amount: number, mode: 'round' | 'trunc'): bigint {
    if (Number.isNaN(amount) || amount < 0 || amount > Number(U64_MAX)) {
        throw new Error(`Amount out of range: ${amount}`);
    }
    const integral = BigInt(mode === 'round' ? Math.round(amount) : Math.trunc(amount));
    return integral > U64_MAX ? U64_MAX : integral;
}

/**
 * Retrieves the current timestamp from the Solana clock sysvar.
 * @param rpc - The Solana rpc object.
 * @returns A promise that resolves to the current timestamp in seconds.
 * @throws An error if the sysvar clock cannot be fetched or parsed.
 */
async function getSysvarClockTimestamp(rpc: Rpc<GetAccountInfoApi>): Promise<UnixTimestamp> {
    const info = await fetchSysvarClock(rpc);
    if (!info) {
        throw new Error('Failed to fetch sysvar clock');
    }
    return info.unixTimestamp;
}

// ========== INTEREST BEARING MINT FUNCTIONS ==========

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
    currentTimestamp: number,
    lastUpdateTimestamp: number,
    initializationTimestamp: number,
    preUpdateAverageRate: number,
    currentRate: number,
): string {
    const totalScale = calculateTotalScale({
        currentTimestamp,
        lastUpdateTimestamp,
        initializationTimestamp,
        preUpdateAverageRate,
        currentRate,
    });

    // Scale by the total interest factor, which includes the decimal factor
    // on-chain, then format to the mint's decimals like the program does
    const scaledAmount = Number(amount) * (totalScale / getDecimalFactor(decimals));
    return formatUiAmountString(scaledAmount, decimals);
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
    currentTimestamp: number,
    lastUpdateTimestamp: number,
    initializationTimestamp: number,
    preUpdateAverageRate: number,
    currentRate: number,
): bigint {
    const uiAmountNumber = parseUiAmountF64(uiAmount);

    const totalScale = calculateTotalScale({
        currentTimestamp,
        lastUpdateTimestamp,
        initializationTimestamp,
        preUpdateAverageRate,
        currentRate,
    });

    // Divide by the total scale, which includes the decimal factor on-chain.
    // The program rounds rather than truncates on this path.
    const originalPrincipal = uiAmountNumber / (totalScale / getDecimalFactor(decimals));
    return f64AmountToU64(originalPrincipal, 'round');
}

// ========== SCALED UI AMOUNT MINT FUNCTIONS ==========

/**
 * Convert amount to UiAmount for a mint with scaled UI amount extension
 * @param amount     Amount of tokens to be converted
 * @param decimals   Number of decimals of the mint
 * @param multiplier Multiplier to scale the amount
 * @return Scaled UI amount as a string
 */
export function amountToUiAmountForScaledUiAmountMintWithoutSimulation(
    amount: bigint,
    decimals: number,
    multiplier: number,
): string {
    // Scale by the total multiplier, which includes the decimal factor
    // on-chain, then format to the mint's decimals like the program does
    const scaledAmount = Number(amount) * (multiplier / getDecimalFactor(decimals));
    return formatUiAmountString(scaledAmount, decimals);
}

/**
 * Convert a UI amount back to the raw amount for a mint with a scaled UI amount extension
 * @param uiAmount       UI Amount to be converted back to raw amount
 * @param decimals       Number of decimals for the mint
 * @param multiplier     Multiplier for the scaled UI amount
 *
 * @return Raw amount
 */
export function uiAmountToAmountForScaledUiAmountMintWithoutSimulation(
    uiAmount: string,
    decimals: number,
    multiplier: number,
): bigint {
    const uiAmountNumber = parseUiAmountF64(uiAmount);
    // Divide by the total multiplier, which includes the decimal factor on-chain
    const rawAmount = uiAmountNumber / (multiplier / getDecimalFactor(decimals));
    return f64AmountToU64(rawAmount, 'trunc');
}

// ========== MAIN ENTRY POINT FUNCTIONS ==========

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
    amount: bigint,
): Promise<string> {
    const accountInfo = await fetchMint(rpc, mint);
    const extensions = unwrapOption(accountInfo.data.extensions);

    // Check for interest bearing mint extension
    const interestBearingMintConfigState = extensions?.find(ext => ext.__kind === 'InterestBearingConfig');

    // Check for scaled UI amount extension
    const scaledUiAmountConfig = extensions?.find(ext => ext.__kind === 'ScaledUiAmountConfig');

    // If no special extension, do standard conversion
    if (!interestBearingMintConfigState && !scaledUiAmountConfig) {
        return amountToUiAmountStringTrimmed(amount, accountInfo.data.decimals);
    }

    // Get timestamp if needed for special mint types
    const timestamp = await getSysvarClockTimestamp(rpc);

    // Handle interest bearing mint
    if (interestBearingMintConfigState) {
        return amountToUiAmountForInterestBearingMintWithoutSimulation(
            amount,
            accountInfo.data.decimals,
            Number(timestamp),
            Number(interestBearingMintConfigState.lastUpdateTimestamp),
            Number(interestBearingMintConfigState.initializationTimestamp),
            interestBearingMintConfigState.preUpdateAverageRate,
            interestBearingMintConfigState.currentRate,
        );
    }

    // At this point, we know it must be a scaled UI amount mint
    if (scaledUiAmountConfig) {
        let multiplier = scaledUiAmountConfig.multiplier;
        // Use new multiplier if it's effective
        if (timestamp >= scaledUiAmountConfig.newMultiplierEffectiveTimestamp) {
            multiplier = scaledUiAmountConfig.newMultiplier;
        }
        return amountToUiAmountForScaledUiAmountMintWithoutSimulation(amount, accountInfo.data.decimals, multiplier);
    }

    // This should never happen due to the conditions above
    throw new Error('Unknown mint extension type');
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
    uiAmount: string,
): Promise<bigint> {
    const accountInfo = await fetchMint(rpc, mint);
    const extensions = unwrapOption(accountInfo.data.extensions);

    // Check for interest bearing mint extension
    const interestBearingMintConfigState = extensions?.find(ext => ext.__kind === 'InterestBearingConfig');

    // Check for scaled UI amount extension
    const scaledUiAmountConfig = extensions?.find(ext => ext.__kind === 'ScaledUiAmountConfig');

    // If no special extension, do standard conversion
    if (!interestBearingMintConfigState && !scaledUiAmountConfig) {
        return uiAmountStringToAmount(uiAmount, accountInfo.data.decimals);
    }

    // Get timestamp if needed for special mint types
    const timestamp = await getSysvarClockTimestamp(rpc);

    // Handle interest bearing mint
    if (interestBearingMintConfigState) {
        return uiAmountToAmountForInterestBearingMintWithoutSimulation(
            uiAmount,
            accountInfo.data.decimals,
            Number(timestamp),
            Number(interestBearingMintConfigState.lastUpdateTimestamp),
            Number(interestBearingMintConfigState.initializationTimestamp),
            interestBearingMintConfigState.preUpdateAverageRate,
            interestBearingMintConfigState.currentRate,
        );
    }

    // At this point, we know it must be a scaled UI amount mint
    if (scaledUiAmountConfig) {
        let multiplier = scaledUiAmountConfig.multiplier;
        // Use new multiplier if it's effective
        if (timestamp >= scaledUiAmountConfig.newMultiplierEffectiveTimestamp) {
            multiplier = scaledUiAmountConfig.newMultiplier;
        }
        return uiAmountToAmountForScaledUiAmountMintWithoutSimulation(uiAmount, accountInfo.data.decimals, multiplier);
    }

    // This should never happen due to the conditions above
    throw new Error('Unknown mint extension type');
}
