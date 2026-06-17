use {
    super::{
        adjust_len_for_multisig, try_for_each_tlv_extension_type, AccountType, BaseState,
        BaseStateWithExtensions, ExtensionType, PodStateWithExtensions,
        BASE_ACCOUNT_AND_TYPE_LENGTH,
    },
    crate::{error::TokenError, pod::PodMint, state::Account},
    solana_program_error::ProgramError,
};

/// Accumulates the total TLV length of the inserted extension types, counting each
/// distinct type once. A no-alloc version of summing over a set.
#[derive(Debug, Default)]
pub(crate) struct TlvLenAccumulator {
    /// Bitset of the extension types inserted so far
    seen: u64,
    /// Total TLV length of the distinct inserted types
    byte_count: usize,
}

impl TlvLenAccumulator {
    /// The bit recording the extension type in `seen`. The bit test in this module
    /// verifies that every `ExtensionType` holds a distinct bit within the `u64`
    fn bit(extension_type: ExtensionType) -> u64 {
        #[cfg(test)]
        match extension_type {
            // The test-only types live at the top of the `u16` discriminant range,
            // so they are mirrored onto the highest bits
            ExtensionType::VariableLenMintTest => return 1 << 61,
            ExtensionType::AccountPaddingTest => return 1 << 62,
            ExtensionType::MintPaddingTest => return 1 << 63,
            _ => (),
        }
        1 << u16::from(extension_type)
    }

    /// Adds the extension type's TLV length unless the type was already inserted
    pub(crate) fn insert(&mut self, extension_type: ExtensionType) -> Result<(), ProgramError> {
        let bit = Self::bit(extension_type);
        if self.seen & bit == 0 {
            self.seen |= bit;
            self.byte_count = self
                .byte_count
                .saturating_add(extension_type.try_get_tlv_len()?);
        }
        Ok(())
    }

    /// The account length for base state `S` followed by the accumulated TLV entries
    pub(crate) fn account_len<S: BaseState>(&self) -> usize {
        if self.seen == 0 {
            S::SIZE_OF
        } else {
            adjust_len_for_multisig(self.byte_count.saturating_add(BASE_ACCOUNT_AND_TYPE_LENGTH))
        }
    }
}

/// Visit the account extensions that `InitializeAccount` must create for the given mint TLV
/// data, in TLV order. The allocation-free equivalent of calling `f` on
/// [`ExtensionType::get_required_init_account_extensions`]
pub fn try_for_each_required_init_account_extension<F>(
    mint_tlv_data: &[u8],
    mut f: F,
) -> Result<(), ProgramError>
where
    F: FnMut(ExtensionType) -> Result<(), ProgramError>,
{
    try_for_each_tlv_extension_type(mint_tlv_data, |mint_extension_type| {
        for &extension_type in mint_extension_type.required_init_account_extensions() {
            f(extension_type)?;
        }
        Ok(())
    })
    .map(|_| ())
}

/// Calculate the account length for a token account of the given mint data, with
/// `additional_account_extensions` requested on top of the account extensions the mint requires.
pub fn try_calculate_account_len_from_mint_data(
    mint_data: &[u8],
    additional_account_extensions: &[ExtensionType],
) -> Result<usize, ProgramError> {
    if additional_account_extensions
        .iter()
        .any(|&extension_type| extension_type.get_account_type() != AccountType::Account)
    {
        return Err(TokenError::ExtensionTypeMismatch.into());
    }

    let state = PodStateWithExtensions::<PodMint>::unpack(mint_data)
        .map_err(|_| TokenError::InvalidMint)?;

    // Size the account extensions the mint requires
    let mut tlv_len = TlvLenAccumulator::default();
    try_for_each_required_init_account_extension(state.get_tlv_data(), |extension_type| {
        tlv_len.insert(extension_type)
    })?;

    // Add the requested ones. `insert` dedupes, so overlap with the required
    // extensions is only sized once.
    for &extension_type in additional_account_extensions {
        tlv_len.insert(extension_type)?;
    }

    Ok(tlv_len.account_len::<Account>())
}

#[cfg(test)]
mod tests {
    use {
        super::{
            super::{
                AccountType, BaseStateWithExtensions, PodStateWithExtensions, BASE_ACCOUNT_LENGTH,
            },
            *,
        },
        crate::state::{test::TEST_MINT_SLICE, Mint, Multisig, PackedSizeOf},
        alloc::{vec, vec::Vec},
        core::mem::size_of,
        solana_program_pack::Pack,
        strum::IntoEnumIterator,
        test_case::test_case,
    };

    fn push_tlv_entry(data: &mut Vec<u8>, extension_type: ExtensionType, value_len: usize) {
        data.extend_from_slice(&u16::from(extension_type).to_le_bytes());
        data.extend_from_slice(&u16::try_from(value_len).unwrap().to_le_bytes());
        data.resize(data.len().saturating_add(value_len), 0);
    }

    fn mint_data_with_tlv_entries(entries: &[(ExtensionType, usize)]) -> Vec<u8> {
        let mut data = TEST_MINT_SLICE.to_vec();
        data.resize(BASE_ACCOUNT_LENGTH, 0);
        data.push(AccountType::Mint.into());
        for &(extension_type, value_len) in entries {
            push_tlv_entry(&mut data, extension_type, value_len);
        }
        data
    }

    #[test_case(
        TEST_MINT_SLICE.to_vec(), &[],
        Account::SIZE_OF;
        "mint with no extensions"
    )]
    #[test_case(
        mint_data_with_tlv_entries(&[(ExtensionType::MintCloseAuthority, 0)]), &[],
        Account::SIZE_OF;
        "mint extension with no required account extensions"
    )]
    // 165 base + 1 account type + (4 header + 0 `ImmutableOwner`) + (4 header + 1
    // `MemoTransfer`) + (4 header + 1 `CpiGuard`)
    #[test_case(
        TEST_MINT_SLICE.to_vec(),
        &[
            ExtensionType::ImmutableOwner,
            ExtensionType::MemoTransfer,
            ExtensionType::CpiGuard,
        ],
        180;
        "standalone account extensions"
    )]
    // 165 base + 1 account type + (4 header + 0 `NonTransferableAccount`) + (4 header + 0
    // `ImmutableOwner`)
    #[test_case(
        mint_data_with_tlv_entries(&[(ExtensionType::NonTransferable, 0)]),
        &[
            ExtensionType::ImmutableOwner,
            ExtensionType::NonTransferableAccount,
            ExtensionType::ImmutableOwner,
        ],
        174;
        "requested extensions overlap required ones"
    )]
    #[test_case(
        {
            let mut data = mint_data_with_tlv_entries(&[(ExtensionType::TransferFeeConfig, 0)]);
            data.push(0);
            data
        },
        &[],
        178;
        "trailing realloc byte is ignored"
    )]
    #[test_case(
        mint_data_with_tlv_entries(&[(ExtensionType::MintPaddingTest, 0)]), &[],
        Multisig::LEN + size_of::<ExtensionType>();
        "multisig len from mint extension is padded"
    )]
    #[test_case(
        TEST_MINT_SLICE.to_vec(), &[ExtensionType::AccountPaddingTest],
        Multisig::LEN + size_of::<ExtensionType>();
        "multisig len from requested extension is padded"
    )]
    fn sizes_to_known_len(
        mint_data: Vec<u8>,
        additional_account_extensions: &[ExtensionType],
        expected_len: usize,
    ) {
        assert_eq!(
            try_calculate_account_len_from_mint_data(&mint_data, additional_account_extensions)
                .unwrap(),
            expected_len,
        );
    }

    // Bad input cases that aren't possible from within the token program, but proves
    // external usage can handle some bogus params.
    #[test_case(
        mint_data_with_tlv_entries(&[(ExtensionType::ImmutableOwner, 0)]),
        Account::SIZE_OF;
        "account extension inside mint tlv contributes nothing"
    )]
    #[test_case(
        mint_data_with_tlv_entries(&[
            (ExtensionType::NonTransferable, 0),
            (ExtensionType::NonTransferable, 0),
        ]),
        174;
        "duplicate mint extensions"
    )]
    #[test_case(
        mint_data_with_tlv_entries(&[(ExtensionType::TransferFeeConfig, 5)]),
        178;
        "account size is computed from the extension types alone"
    )]
    #[test_case(
        {
            let mut data = mint_data_with_tlv_entries(&[(ExtensionType::TransferFeeConfig, 0)]);
            data.extend_from_slice(&u16::from(ExtensionType::Uninitialized).to_le_bytes());
            data.extend_from_slice(&[0xff; 7]);
            data
        },
        178;
        "bytes after uninitialized terminator are ignored"
    )]
    fn sizes_unwritable_mint_bytes_to_known_len(mint_data: Vec<u8>, expected_len: usize) {
        assert_eq!(
            try_calculate_account_len_from_mint_data(&mint_data, &[]).unwrap(),
            expected_len,
        );
    }

    #[test_case(
        vec![];
        "empty mint data"
    )]
    #[test_case(
        vec![0; Mint::LEN];
        "uninitialized mint"
    )]
    #[test_case(
        {
            let mut data = mint_data_with_tlv_entries(&[]);
            data.resize(Multisig::LEN, 0);
            data
        };
        "mint data of multisig len"
    )]
    fn rejects_invalid_mint_data(mint_data: Vec<u8>) {
        assert_eq!(
            try_calculate_account_len_from_mint_data(&mint_data, &[]),
            Err(TokenError::InvalidMint.into()),
        );
    }

    #[test_case(ExtensionType::TransferFeeConfig; "mint extension")]
    #[test_case(ExtensionType::Uninitialized; "uninitialized")]
    fn rejects_non_account_additional_extension(extension_type: ExtensionType) {
        assert_eq!(
            try_calculate_account_len_from_mint_data(TEST_MINT_SLICE, &[extension_type]),
            Err(TokenError::ExtensionTypeMismatch.into()),
        );
    }

    #[test_case(
        {
            let mut tail = u16::from(ExtensionType::TransferFeeConfig).to_le_bytes().to_vec();
            tail.push(0);
            tail
        };
        "entry truncated after its type"
    )]
    #[test_case(
        [999u16.to_le_bytes(), 0u16.to_le_bytes()].concat();
        "unknown extension type"
    )]
    fn malformed_tlv_tail_is_invalid_account_data(tail: Vec<u8>) {
        let mut data = mint_data_with_tlv_entries(&[]);
        data.extend_from_slice(&tail);
        assert_eq!(
            try_calculate_account_len_from_mint_data(&data, &[]),
            Err(ProgramError::InvalidAccountData),
        );
    }

    #[test]
    fn visits_required_account_extensions_in_tlv_order() {
        let mint_data = mint_data_with_tlv_entries(&[
            (ExtensionType::TransferFeeConfig, 0),
            (ExtensionType::NonTransferable, 0),
        ]);
        let mint = PodStateWithExtensions::<PodMint>::unpack(&mint_data).unwrap();

        let mut visited = Vec::new();
        try_for_each_required_init_account_extension(mint.get_tlv_data(), |extension_type| {
            visited.push(extension_type);
            Ok(())
        })
        .unwrap();

        assert_eq!(
            visited,
            [
                ExtensionType::TransferFeeAmount,
                ExtensionType::NonTransferableAccount,
                ExtensionType::ImmutableOwner,
            ]
        );
    }

    #[test]
    fn visitor_error_aborts_the_walk() {
        let mint_data = mint_data_with_tlv_entries(&[
            (ExtensionType::NonTransferable, 0),
            (ExtensionType::TransferFeeConfig, 0),
        ]);
        let mint = PodStateWithExtensions::<PodMint>::unpack(&mint_data).unwrap();

        let mut visits = 0;
        assert_eq!(
            try_for_each_required_init_account_extension(mint.get_tlv_data(), |_| {
                visits += 1;
                Err(ProgramError::Custom(42))
            }),
            Err(ProgramError::Custom(42)),
        );
        assert_eq!(visits, 1);
    }

    #[test]
    fn every_extension_type_holds_a_distinct_bit() {
        let mut seen = 0u64;
        for extension_type in ExtensionType::iter() {
            let bit = TlvLenAccumulator::bit(extension_type);
            assert_eq!(
                seen & bit,
                0,
                "{extension_type:?} shares its bit with another extension type."
            );
            seen |= bit;
        }
    }
}
