use num_traits::{pow, Float};

// The interface crate uses `num_traits` float helpers instead of inherent `f64` methods
// so the same code compiles for no-std targets. These tests validate the new helpers
// match the inherent `f64` methods.

const FLOAT_CASES: [f64; 19] = [
    f64::NEG_INFINITY,
    -f64::MAX,
    -123_456_789.987_654_33,
    -10.5,
    -2.0,
    -1.5,
    -1.0,
    -0.5,
    -0.0,
    0.0,
    0.5,
    1.0,
    1.5,
    2.0,
    10.5,
    123_456_789.987_654_33,
    f64::MIN_POSITIVE,
    f64::MAX,
    f64::INFINITY,
];

#[test]
fn num_traits_pow_matches_f64_powi_for_all_u8_decimals() {
    for decimals in 0..=u8::MAX {
        assert_eq!(
            pow(10_f64, decimals as usize).to_bits(),
            10_f64.powi(decimals as i32).to_bits(),
            "decimals={decimals}"
        );
    }
}

#[test]
fn num_traits_float_methods_match_f64_methods() {
    for x in FLOAT_CASES {
        assert_eq!(Float::exp(x).to_bits(), x.exp().to_bits(), "exp({x})");
        assert_eq!(Float::round(x).to_bits(), x.round().to_bits(), "round({x})");
        assert_eq!(Float::trunc(x).to_bits(), x.trunc().to_bits(), "trunc({x})");
    }
}
