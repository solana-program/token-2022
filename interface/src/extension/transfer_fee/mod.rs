use {
    crate::{
        error::TokenError,
        extension::{Extension, ExtensionType},
        pod::PodU256,
    },
    bytemuck::{Pod, Zeroable},
    core::cmp,
    ethnum::U256,
    solana_address::Address,
    solana_nullable::MaybeNull,
    solana_program_error::ProgramResult,
    solana_zero_copy::unaligned::{U16, U64},
};
#[cfg(feature = "serde")]
use {
    serde::{Deserialize, Serialize},
    serde_with::{As, DisplayFromStr},
};

/// Transfer fee extension instructions
pub mod instruction;

/// Maximum possible fee in basis points is `100%`, aka 10,000 basis points
pub const MAX_FEE_BASIS_POINTS: u16 = 10_000;
const ONE_IN_BASIS_POINTS: U256 = U256::new(MAX_FEE_BASIS_POINTS as u128);

/// Transfer fee information
#[repr(C)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct TransferFee {
    /// First epoch where the transfer fee takes effect
    pub epoch: U64, // Epoch,
    /// Maximum fee assessed on transfers, expressed as an amount of tokens
    pub maximum_fee: PodU256,
    /// Amount of transfer collected as fees, expressed as basis points of the
    /// transfer amount (increments of `0.01%`)
    pub transfer_fee_basis_points: U16,
}
impl TransferFee {
    /// Calculate ceiling-division
    ///
    /// Ceiling-division
    ///     `ceil[ numerator / denominator ]`
    /// can be represented as a floor-division
    ///     `floor[ (numerator + denominator - 1) / denominator]`
    fn ceil_div(numerator: U256, denominator: U256) -> Option<U256> {
        numerator
            .checked_add(denominator)?
            .checked_sub(U256::ONE)?
            .checked_div(denominator)
    }

    /// Calculate the transfer fee
    ///
    /// Returns `None` if the intermediate product `pre_fee_amount * basis_points`
    /// overflows 256 bits.
    pub fn calculate_fee(&self, pre_fee_amount: U256) -> Option<U256> {
        let transfer_fee_basis_points = U256::from(u16::from(self.transfer_fee_basis_points));
        if transfer_fee_basis_points == U256::ZERO || pre_fee_amount == U256::ZERO {
            Some(U256::ZERO)
        } else {
            let numerator = pre_fee_amount.checked_mul(transfer_fee_basis_points)?;
            let raw_fee = Self::ceil_div(numerator, ONE_IN_BASIS_POINTS)?;
            Some(cmp::min(raw_fee, U256::from(self.maximum_fee)))
        }
    }

    /// Calculate the gross transfer amount after deducting fees
    pub fn calculate_post_fee_amount(&self, pre_fee_amount: U256) -> Option<U256> {
        pre_fee_amount.checked_sub(self.calculate_fee(pre_fee_amount)?)
    }

    /// Calculate the transfer amount that will result in a specified net
    /// transfer amount.
    ///
    /// The original transfer amount may not always be unique due to rounding.
    /// In this case, the smaller amount will be chosen.
    /// e.g. Both transfer amount 10, 11 with `10%` fee rate results in net
    /// transfer amount of 9. In this case, 10 will be chosen.
    /// e.g. Fee rate is `100%`. In this case, 0 will be chosen.
    ///
    /// The original transfer amount may not always exist on large net transfer
    /// amounts due to overflow. In this case, `None` is returned.
    /// e.g. The net fee amount is `U256::MAX` with a positive fee rate.
    pub fn calculate_pre_fee_amount(&self, post_fee_amount: U256) -> Option<U256> {
        let maximum_fee = U256::from(self.maximum_fee);
        let transfer_fee_basis_points = U256::from(u16::from(self.transfer_fee_basis_points));
        if transfer_fee_basis_points == U256::ZERO {
            // no fee, same amount
            Some(post_fee_amount)
        } else if post_fee_amount == U256::ZERO {
            // 0 zero out, 0 in
            Some(U256::ZERO)
        } else if transfer_fee_basis_points == ONE_IN_BASIS_POINTS {
            // 100%, cap at max fee
            maximum_fee.checked_add(post_fee_amount)
        } else {
            let numerator = post_fee_amount.checked_mul(ONE_IN_BASIS_POINTS)?;
            let denominator = ONE_IN_BASIS_POINTS.checked_sub(transfer_fee_basis_points)?;
            let raw_pre_fee_amount = Self::ceil_div(numerator, denominator)?;

            if raw_pre_fee_amount.checked_sub(post_fee_amount)? >= maximum_fee {
                post_fee_amount.checked_add(maximum_fee)
            } else {
                Some(raw_pre_fee_amount)
            }
        }
    }

    /// Calculate the fee that would produce the given output
    ///
    /// Note: this function is not an exact inverse operation of
    /// `calculate_fee`. Meaning, it is not the case that:
    ///
    /// `calculate_fee(x) == calculate_inverse_fee(x - calculate_fee(x))`
    ///
    /// Only the following relationship holds:
    ///
    /// `calculate_fee(x) >= calculate_inverse_fee(x - calculate_fee(x))`
    pub fn calculate_inverse_fee(&self, post_fee_amount: U256) -> Option<U256> {
        let pre_fee_amount = self.calculate_pre_fee_amount(post_fee_amount)?;
        self.calculate_fee(pre_fee_amount)
    }
}

/// Transfer fee extension data for mints.
#[repr(C)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct TransferFeeConfig {
    /// Optional authority to set the fee
    #[cfg_attr(feature = "serde", serde(with = "As::<Option<DisplayFromStr>>"))]
    pub transfer_fee_config_authority: MaybeNull<Address>,
    /// Withdraw from mint instructions must be signed by this key
    #[cfg_attr(feature = "serde", serde(with = "As::<Option<DisplayFromStr>>"))]
    pub withdraw_withheld_authority: MaybeNull<Address>,
    /// Withheld transfer fee tokens that have been moved to the mint for
    /// withdrawal
    pub withheld_amount: PodU256,
    /// Older transfer fee, used if `current epoch < new_transfer_fee.epoch`
    pub older_transfer_fee: TransferFee,
    /// Newer transfer fee, used if `current epoch >= new_transfer_fee.epoch`
    pub newer_transfer_fee: TransferFee,
}
impl TransferFeeConfig {
    /// Get the fee for the given epoch
    pub fn get_epoch_fee(&self, epoch: u64) -> &TransferFee {
        if epoch >= self.newer_transfer_fee.epoch.into() {
            &self.newer_transfer_fee
        } else {
            &self.older_transfer_fee
        }
    }
    /// Calculate the fee for the given epoch and input amount
    pub fn calculate_epoch_fee(&self, epoch: u64, pre_fee_amount: U256) -> Option<U256> {
        self.get_epoch_fee(epoch).calculate_fee(pre_fee_amount)
    }
    /// Calculate the fee for the given epoch and output amount
    pub fn calculate_inverse_epoch_fee(&self, epoch: u64, post_fee_amount: U256) -> Option<U256> {
        self.get_epoch_fee(epoch)
            .calculate_inverse_fee(post_fee_amount)
    }
}
impl Extension for TransferFeeConfig {
    const TYPE: ExtensionType = ExtensionType::TransferFeeConfig;
}

/// Transfer fee extension data for accounts.
#[repr(C)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct TransferFeeAmount {
    /// Amount withheld during transfers, to be harvested to the mint
    pub withheld_amount: PodU256,
}
impl TransferFeeAmount {
    /// Check if the extension is in a closable state
    pub fn closable(&self) -> ProgramResult {
        if self.withheld_amount == PodU256::ZERO {
            Ok(())
        } else {
            Err(TokenError::AccountHasWithheldTransferFees.into())
        }
    }
}
impl Extension for TransferFeeAmount {
    const TYPE: ExtensionType = ExtensionType::TransferFeeAmount;
}

#[cfg(test)]
pub(crate) mod test {
    use {super::*, proptest::prelude::*, solana_address::Address};

    const NEWER_EPOCH: u64 = 100;
    const OLDER_EPOCH: u64 = 1;

    fn u(n: u64) -> U256 {
        U256::from(n)
    }

    pub(crate) fn test_transfer_fee_config() -> TransferFeeConfig {
        TransferFeeConfig {
            transfer_fee_config_authority: Some(Address::new_from_array([10; 32]))
                .try_into()
                .unwrap(),
            withdraw_withheld_authority: Some(Address::new_from_array([11; 32]))
                .try_into()
                .unwrap(),
            withheld_amount: PodU256::from(U256::MAX),
            older_transfer_fee: TransferFee {
                epoch: U64::from(OLDER_EPOCH),
                maximum_fee: PodU256::from(10u64),
                transfer_fee_basis_points: U16::from(100),
            },
            newer_transfer_fee: TransferFee {
                epoch: U64::from(NEWER_EPOCH),
                maximum_fee: PodU256::from(5_000u64),
                transfer_fee_basis_points: U16::from(1),
            },
        }
    }

    #[test]
    fn epoch_fee() {
        let transfer_fee_config = test_transfer_fee_config();
        // during epoch 100 and after, use newer transfer fee
        assert_eq!(
            transfer_fee_config.get_epoch_fee(NEWER_EPOCH).epoch,
            NEWER_EPOCH.into()
        );
        assert_eq!(
            transfer_fee_config.get_epoch_fee(NEWER_EPOCH + 1).epoch,
            NEWER_EPOCH.into()
        );
        assert_eq!(
            transfer_fee_config.get_epoch_fee(u64::MAX).epoch,
            NEWER_EPOCH.into()
        );
        // before that, use older transfer fee
        assert_eq!(
            transfer_fee_config.get_epoch_fee(NEWER_EPOCH - 1).epoch,
            OLDER_EPOCH.into()
        );
        assert_eq!(
            transfer_fee_config.get_epoch_fee(OLDER_EPOCH).epoch,
            OLDER_EPOCH.into()
        );
        assert_eq!(
            transfer_fee_config.get_epoch_fee(OLDER_EPOCH + 1).epoch,
            OLDER_EPOCH.into()
        );
    }

    #[test]
    fn calculate_fee_max() {
        let one = ONE_IN_BASIS_POINTS;
        let transfer_fee = TransferFee {
            epoch: U64::from(0),
            maximum_fee: PodU256::from(5_000u64),
            transfer_fee_basis_points: U16::from(1),
        };
        let maximum_fee = U256::from(transfer_fee.maximum_fee);
        // hit maximum fee
        assert_eq!(
            maximum_fee,
            transfer_fee.calculate_fee(u(u64::MAX)).unwrap()
        );
        // hit maximum fee with a value far above u64::MAX
        assert_eq!(
            maximum_fee,
            transfer_fee.calculate_fee(U256::MAX / one).unwrap()
        );
        // at exactly the max
        assert_eq!(
            maximum_fee,
            transfer_fee.calculate_fee(maximum_fee * one).unwrap()
        );
        // one token above, normally rounds up, but we're at the max
        assert_eq!(
            maximum_fee,
            transfer_fee.calculate_fee(maximum_fee * one + 1).unwrap()
        );
        // one token below, rounds up to the max
        assert_eq!(
            maximum_fee,
            transfer_fee.calculate_fee(maximum_fee * one - 1).unwrap()
        );
        // the intermediate product overflows U256
        assert_eq!(None, transfer_fee.calculate_fee(U256::MAX));
    }

    #[test]
    fn calculate_fee_min() {
        let one = ONE_IN_BASIS_POINTS;
        let transfer_fee = TransferFee {
            epoch: U64::from(0),
            maximum_fee: PodU256::from(5_000u64),
            transfer_fee_basis_points: U16::from(1),
        };
        let minimum_fee = U256::ONE;
        // hit minimum fee even with 1 token
        assert_eq!(minimum_fee, transfer_fee.calculate_fee(u(1)).unwrap());
        // still minimum at 2 tokens
        assert_eq!(minimum_fee, transfer_fee.calculate_fee(u(2)).unwrap());
        // still minimum at 10_000 tokens
        assert_eq!(minimum_fee, transfer_fee.calculate_fee(one).unwrap());
        // 2 token fee at 10_001
        assert_eq!(
            minimum_fee + 1,
            transfer_fee.calculate_fee(one + 1).unwrap()
        );
        // zero is always zero
        assert_eq!(U256::ZERO, transfer_fee.calculate_fee(U256::ZERO).unwrap());
    }

    #[test]
    fn calculate_fee_zero() {
        let one = ONE_IN_BASIS_POINTS;
        let transfer_fee = TransferFee {
            epoch: U64::from(0),
            maximum_fee: PodU256::from(U256::MAX),
            transfer_fee_basis_points: U16::from(0),
        };
        // always zero fee
        assert_eq!(U256::ZERO, transfer_fee.calculate_fee(U256::ZERO).unwrap());
        assert_eq!(U256::ZERO, transfer_fee.calculate_fee(U256::MAX).unwrap());
        assert_eq!(U256::ZERO, transfer_fee.calculate_fee(u(1)).unwrap());
        assert_eq!(U256::ZERO, transfer_fee.calculate_fee(one).unwrap());

        let transfer_fee = TransferFee {
            epoch: U64::from(0),
            maximum_fee: PodU256::ZERO,
            transfer_fee_basis_points: U16::from(MAX_FEE_BASIS_POINTS),
        };
        // always zero fee
        assert_eq!(U256::ZERO, transfer_fee.calculate_fee(U256::ZERO).unwrap());
        assert_eq!(U256::ZERO, transfer_fee.calculate_fee(u(u64::MAX)).unwrap());
        assert_eq!(U256::ZERO, transfer_fee.calculate_fee(u(1)).unwrap());
        assert_eq!(U256::ZERO, transfer_fee.calculate_fee(one).unwrap());
    }

    #[test]
    fn calculate_fee_exact_out_max() {
        let one = ONE_IN_BASIS_POINTS;
        let transfer_fee = TransferFee {
            epoch: U64::from(0),
            maximum_fee: PodU256::from(5_000u64),
            transfer_fee_basis_points: U16::from(1),
        };
        let maximum_fee = U256::from(transfer_fee.maximum_fee);
        // hit maximum fee
        assert_eq!(
            maximum_fee,
            transfer_fee
                .calculate_inverse_fee(u(u64::MAX) - maximum_fee)
                .unwrap()
        );
        // at exactly the max
        assert_eq!(
            maximum_fee,
            transfer_fee
                .calculate_inverse_fee(maximum_fee * one - maximum_fee)
                .unwrap()
        );
        // one token above, normally rounds up, but we're at the max
        assert_eq!(
            maximum_fee,
            transfer_fee
                .calculate_inverse_fee(maximum_fee * one - maximum_fee + 1)
                .unwrap()
        );
        // one token below, rounds up to the max
        assert_eq!(
            maximum_fee,
            transfer_fee
                .calculate_inverse_fee(maximum_fee * one - maximum_fee - 1)
                .unwrap()
        );
    }

    #[test]
    fn calculate_pre_fee_amount_edge_cases() {
        let maximum_fee = u(5_000);
        let transfer_fee = TransferFee {
            epoch: U64::from(0),
            maximum_fee: PodU256::from(maximum_fee),
            transfer_fee_basis_points: U16::from(MAX_FEE_BASIS_POINTS),
        };

        // 0 zero out, 0 in
        assert_eq!(
            U256::ZERO,
            transfer_fee.calculate_pre_fee_amount(U256::ZERO).unwrap()
        );

        // cap at max fee
        assert_eq!(
            maximum_fee + 1,
            transfer_fee.calculate_pre_fee_amount(u(1)).unwrap()
        );

        // overflow at 100% fee
        assert_eq!(None, transfer_fee.calculate_pre_fee_amount(U256::MAX));

        // no fee same amount
        let transfer_fee = TransferFee {
            epoch: U64::from(0),
            maximum_fee: PodU256::from(maximum_fee),
            transfer_fee_basis_points: U16::from(0),
        };
        assert_eq!(u(1), transfer_fee.calculate_pre_fee_amount(u(1)).unwrap());
    }

    #[test]
    fn calculate_fee_exact_out_min() {
        let one = ONE_IN_BASIS_POINTS;
        let transfer_fee = TransferFee {
            epoch: U64::from(0),
            maximum_fee: PodU256::from(5_000u64),
            transfer_fee_basis_points: U16::from(1),
        };
        let minimum_fee = U256::ONE;
        // hit minimum fee even with 1 token
        assert_eq!(
            minimum_fee,
            transfer_fee.calculate_inverse_fee(u(1)).unwrap()
        );
        // still minimum at 2 tokens
        assert_eq!(
            minimum_fee,
            transfer_fee.calculate_inverse_fee(u(2)).unwrap()
        );
        // still minimum at 9_999 tokens
        assert_eq!(
            minimum_fee,
            transfer_fee.calculate_inverse_fee(one - 1).unwrap()
        );
        // 2 token fee at 10_000
        assert_eq!(
            minimum_fee + 1,
            transfer_fee.calculate_inverse_fee(one).unwrap()
        );
        // zero is zero token
        assert_eq!(
            U256::ZERO,
            transfer_fee.calculate_inverse_fee(U256::ZERO).unwrap()
        );
    }

    proptest! {
        #[test]
        fn round_trip_fee_calculation(
            transfer_fee_basis_points in 0u16..MAX_FEE_BASIS_POINTS,
            maximum_fee in u64::MIN..=u64::MAX,
            amount_in in 0..=u64::MAX
        ) {
            let transfer_fee = TransferFee {
                epoch: U64::from(0),
                maximum_fee: PodU256::from(maximum_fee),
                transfer_fee_basis_points: U16::from(transfer_fee_basis_points),
            };
            let amount_in = u(amount_in);
            let fee = transfer_fee.calculate_fee(amount_in).unwrap();
            let amount_out = amount_in.checked_sub(fee).unwrap();
            let fee_exact_out = transfer_fee.calculate_inverse_fee(amount_out).unwrap();
            let diff = fee.abs_diff(fee_exact_out);
            // We lose precision with every division by 10000, so for huge amounts,
            // the difference can be in the hundreds. This comes out to less than
            // 1 / 10^15
            let one = ONE_IN_BASIS_POINTS;
            let precision = amount_in / one / one / one;
            assert!(diff < precision, "diff is {} for precision {}", diff, precision);
        }
    }

    proptest! {
        #[test]
        fn round_trip_fee_calculation_wide(
            transfer_fee_basis_points in 0u16..MAX_FEE_BASIS_POINTS,
            maximum_fee in u64::MIN..=u64::MAX,
            amount_in_hi in 1..=u64::MAX,
            amount_in_lo in 0..=u64::MAX
        ) {
            let transfer_fee = TransferFee {
                epoch: U64::from(0),
                maximum_fee: PodU256::from(maximum_fee),
                transfer_fee_basis_points: U16::from(transfer_fee_basis_points),
            };
            // amounts between 2^64 and 2^128, well above the u64 range
            let amount_in = (u(amount_in_hi) << 64) | u(amount_in_lo);
            let fee = transfer_fee.calculate_fee(amount_in).unwrap();
            let amount_out = amount_in.checked_sub(fee).unwrap();
            let fee_exact_out = transfer_fee.calculate_inverse_fee(amount_out).unwrap();
            let diff = fee.abs_diff(fee_exact_out);
            let one = ONE_IN_BASIS_POINTS;
            let precision = amount_in / one / one / one;
            assert!(diff < precision, "diff is {} for precision {}", diff, precision);
        }
    }

    proptest! {
        #[test]
        fn inverse_fee_relationship(
            transfer_fee_basis_points in 0u16..MAX_FEE_BASIS_POINTS,
            maximum_fee in u64::MIN..=u64::MAX,
            amount_in in 0..=u64::MAX
        ) {
            let transfer_fee = TransferFee {
                epoch: U64::from(0),
                maximum_fee: PodU256::from(maximum_fee),
                transfer_fee_basis_points: U16::from(transfer_fee_basis_points),
            };
            let amount_in = u(amount_in);
            let fee = transfer_fee.calculate_fee(amount_in).unwrap();
            let amount_out = amount_in.checked_sub(fee).unwrap();
            let fee_exact_out = transfer_fee.calculate_inverse_fee(amount_out).unwrap();
            assert!(fee >= fee_exact_out);
        }
    }
}
