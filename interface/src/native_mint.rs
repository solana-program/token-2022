//! The Mint that represents the native token

/// There are `10^9` lamports in one SOL
pub const DECIMALS: u8 = 9;

// The Mint for native SOL Token accounts
solana_pubkey::declare_id!("9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP");

/// Seed for the native mint's program-derived address
pub const PROGRAM_ADDRESS_SEEDS: &[&[u8]] = &["native-mint".as_bytes(), &[255]];

#[cfg(test)]
mod tests {
    use {super::*, solana_pubkey::Pubkey};

    #[test]
    fn expected_native_mint_id() {
        let native_mint_id =
            Pubkey::create_program_address(PROGRAM_ADDRESS_SEEDS, &crate::id()).unwrap();
        assert_eq!(id(), native_mint_id);
    }
}
