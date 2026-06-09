use {
    super::{
        adjust_len_for_multisig, try_for_each_tlv_extension_type, AccountType,
        BaseStateWithExtensions, ExtensionType, PodStateWithExtensions,
        BASE_ACCOUNT_AND_TYPE_LENGTH,
    },
    crate::{
        check_program_account,
        error::TokenError,
        pod::PodMint,
        state::{Account, PackedSizeOf},
    },
    solana_address::Address,
    solana_program_error::ProgramError,
};

/// Must stay at or above the number of `AccountType::Account` extension types that exist,
/// which is verified by the capacity test in this module. Note there are currently only 9
/// `AccountType::Account` extension types today but the added slack makes updates easier
/// on external consumers.
const SEEN_ACCOUNT_EXTENSIONS_CAPACITY: usize = 24;

/// A small fixed-capacity set that records which account extension types have already
/// been counted toward an account length.
#[derive(Debug, Default)]
struct SeenAccountExtensions {
    /// The recorded extension types, filled from the front. Only the first `count` slots
    /// are occupied, the rest remain `None`
    seen: [Option<ExtensionType>; SEEN_ACCOUNT_EXTENSIONS_CAPACITY],
    /// How many slots are occupied
    count: usize,
}

impl SeenAccountExtensions {
    /// Records an extension type, returning `true` if it was new and `false` if it
    /// was already in the set
    fn insert(&mut self, extension_type: ExtensionType) -> Result<bool, ProgramError> {
        if self.seen[..self.count].contains(&Some(extension_type)) {
            return Ok(false);
        }

        // Not seen, so take the next free slot
        let slot = self
            .seen
            .get_mut(self.count)
            .ok_or(ProgramError::InvalidAccountData)?;
        *slot = Some(extension_type);
        self.count = self.count.saturating_add(1);

        Ok(true)
    }

    fn is_empty(&self) -> bool {
        self.count == 0
    }
}

/// Calculate the account length for a token account of the given initialized mint,
/// with `additional_account_extensions` requested on top of the account extensions
/// required by the mint.
pub fn try_calculate_account_len_from_mint_data(
    token_program_id: &Address,
    mint_data: &[u8],
    additional_account_extensions: &[ExtensionType],
) -> Result<usize, ProgramError> {
    check_account_extensions(additional_account_extensions)?;
    check_program_account(token_program_id)?;

    let mint = PodStateWithExtensions::<PodMint>::unpack(mint_data)
        .map_err(|_| TokenError::InvalidMint)?;

    // Tracks already counted extension types so overlap between the requested extensions
    // and the mint's required ones is only sized once
    let mut seen = SeenAccountExtensions::default();

    let mut total_tlv_len: usize = 0;

    // Sum the TLV lengths of the requested account extensions
    for &extension_type in additional_account_extensions {
        if seen.insert(extension_type)? {
            total_tlv_len = total_tlv_len.saturating_add(extension_type.try_get_tlv_len()?);
        }
    }

    // Walk the mint's extensions, summing the TLV lengths of the account extensions
    // each one requires
    try_for_each_tlv_extension_type(mint.get_tlv_data(), |mint_extension_type| {
        for &extension_type in mint_extension_type.required_init_account_extensions() {
            if seen.insert(extension_type)? {
                total_tlv_len = total_tlv_len.saturating_add(extension_type.try_get_tlv_len()?);
            }
        }
        Ok(())
    })?;

    // With no extensions, the account stays at the base size
    if seen.is_empty() {
        Ok(Account::SIZE_OF)
    } else {
        // Extensions follow the base account data and account type byte
        let total_len = total_tlv_len.saturating_add(BASE_ACCOUNT_AND_TYPE_LENGTH);
        // the total length must be padded if it collides with `Multisig::LEN`
        Ok(adjust_len_for_multisig(total_len))
    }
}

/// Check that every extension type is an `AccountType::Account` extension
fn check_account_extensions(account_extensions: &[ExtensionType]) -> Result<(), ProgramError> {
    for extension_type in account_extensions {
        if extension_type.get_account_type() != AccountType::Account {
            return Err(TokenError::ExtensionTypeMismatch.into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use {
        super::super::{
            transfer_fee::TransferFeeConfig, BaseStateWithExtensionsMut, StateWithExtensionsMut,
            BASE_ACCOUNT_LENGTH,
        },
        super::*,
        crate::state::{test::TEST_MINT_SLICE, Mint, Multisig},
        alloc::{vec, vec::Vec},
        core::mem::size_of,
        proptest::prelude::*,
        solana_program_pack::Pack,
        strum::IntoEnumIterator,
        test_case::test_case,
    };

    fn all_account_extensions() -> Vec<ExtensionType> {
        ExtensionType::iter()
            .filter(|extension_type| extension_type.get_account_type() == AccountType::Account)
            .collect()
    }

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

    /// The legacy sizing code path formerly used by `GetAccountDataSize`
    /// which the new helper must match exactly
    fn legacy_account_len(
        mint_data: &[u8],
        additional_account_extensions: &[ExtensionType],
    ) -> Result<usize, ProgramError> {
        let state = PodStateWithExtensions::<PodMint>::unpack(mint_data)
            .map_err(|_| TokenError::InvalidMint)?;
        let mut account_extensions =
            ExtensionType::get_required_init_account_extensions(&state.get_extension_types()?);
        account_extensions.extend_from_slice(additional_account_extensions);
        ExtensionType::try_calculate_account_len::<Account>(&account_extensions)
    }

    fn assert_matches_legacy_sizing(
        mint_data: &[u8],
        additional_account_extensions: &[ExtensionType],
    ) {
        assert_eq!(
            try_calculate_account_len_from_mint_data(
                &crate::id(),
                mint_data,
                additional_account_extensions,
            ),
            legacy_account_len(mint_data, additional_account_extensions),
        );
    }

    #[test_case(
        TEST_MINT_SLICE.to_vec(), &[];
        "mint with no extensions"
    )]
    #[test_case(
        TEST_MINT_SLICE.to_vec(),
        &[ExtensionType::ImmutableOwner, ExtensionType::MemoTransfer, ExtensionType::CpiGuard];
        "standalone account extensions"
    )]
    #[test_case(
        mint_data_with_tlv_entries(&[
            (ExtensionType::TransferFeeConfig, 0),
            (ExtensionType::MintCloseAuthority, 0),
            (ExtensionType::DefaultAccountState, 0),
            (ExtensionType::NonTransferable, 0),
        ]),
        &[];
        "multiple mint extensions"
    )]
    #[test_case(
        mint_data_with_tlv_entries(&[(ExtensionType::ImmutableOwner, 0)]), &[];
        "account extension inside mint tlv is ignored"
    )]
    #[test_case(
        mint_data_with_tlv_entries(&[(ExtensionType::NonTransferable, 0)]),
        &[
            ExtensionType::ImmutableOwner,
            ExtensionType::NonTransferableAccount,
            ExtensionType::ImmutableOwner,
        ];
        "required and additional extensions overlap"
    )]
    #[test_case(
        mint_data_with_tlv_entries(&[
            (ExtensionType::NonTransferable, 0),
            (ExtensionType::NonTransferable, 0),
        ]),
        &[];
        "duplicate mint extensions"
    )]
    #[test_case(
        mint_data_with_tlv_entries(&[
            (ExtensionType::TransferFeeConfig, 0),
            (ExtensionType::NonTransferable, 0),
            (ExtensionType::TransferHook, 0),
            (ExtensionType::Pausable, 0),
        ]),
        &all_account_extensions();
        "every account extension at once"
    )]
    fn matches_legacy_sizing(mint_data: Vec<u8>, additional_account_extensions: &[ExtensionType]) {
        assert_matches_legacy_sizing(&mint_data, additional_account_extensions);
    }

    #[test_case(
        TEST_MINT_SLICE.to_vec();
        "mint with no extensions"
    )]
    #[test_case(
        mint_data_with_tlv_entries(&[(ExtensionType::ImmutableOwner, 0)]);
        "account extension inside mint tlv"
    )]
    fn sizes_to_exactly_the_base_account_len(mint_data: Vec<u8>) {
        assert_eq!(
            try_calculate_account_len_from_mint_data(&crate::id(), &mint_data, &[]).unwrap(),
            Account::SIZE_OF,
        );
    }

    #[test]
    fn real_mint_data_sizes_to_known_len() {
        // A wrong TLV layout assumption shared by the test fixtures and the sizing code would
        // cancel out and pass. So here we test a hand-computed length
        let space =
            ExtensionType::try_calculate_account_len::<Mint>(&[ExtensionType::TransferFeeConfig])
                .unwrap();
        let mut mint_data = vec![0; space];
        let mut state =
            StateWithExtensionsMut::<Mint>::unpack_uninitialized(&mut mint_data).unwrap();
        state.init_extension::<TransferFeeConfig>(true).unwrap();
        state.base = Mint {
            is_initialized: true,
            ..Mint::default()
        };
        state.pack_base();
        state.init_account_type().unwrap();

        assert_matches_legacy_sizing(&mint_data, &[ExtensionType::ImmutableOwner]);

        // 165 base + 1 account type + (4 header + 8 `TransferFeeAmount`) + (4 header + 0
        // `ImmutableOwner`)
        assert_eq!(
            try_calculate_account_len_from_mint_data(
                &crate::id(),
                &mint_data,
                &[ExtensionType::ImmutableOwner],
            )
            .unwrap(),
            182,
        );
    }

    #[test]
    fn multisig_len_adjustment_matches_legacy_sizing() {
        // The padding test extensions exist to push the account length to exactly `Multisig::LEN`,
        // which must be adjusted by two bytes
        let mint_data = mint_data_with_tlv_entries(&[(ExtensionType::MintPaddingTest, 0)]);
        assert_matches_legacy_sizing(&mint_data, &[]);
        assert_eq!(
            try_calculate_account_len_from_mint_data(&crate::id(), &mint_data, &[]).unwrap(),
            Multisig::LEN.saturating_add(size_of::<ExtensionType>()),
        );

        assert_matches_legacy_sizing(TEST_MINT_SLICE, &[ExtensionType::AccountPaddingTest]);
    }

    #[test]
    fn declared_tlv_value_length_is_ignored_for_sizing() {
        // Summing the declared value lengths instead of the canonical per-type lengths would
        // pass every well-formed test. So here the entry lies about its length and must size
        // identically to one that does not.
        let lying_length = mint_data_with_tlv_entries(&[(ExtensionType::TransferFeeConfig, 5)]);
        let zero_length = mint_data_with_tlv_entries(&[(ExtensionType::TransferFeeConfig, 0)]);
        assert_matches_legacy_sizing(&lying_length, &[]);
        assert_eq!(
            try_calculate_account_len_from_mint_data(&crate::id(), &lying_length, &[]),
            try_calculate_account_len_from_mint_data(&crate::id(), &zero_length, &[]),
        );
    }

    #[test]
    fn trailing_realloc_byte_ends_the_walk() {
        // A single trailing byte that cannot hold another TLV entry marks the end of the data
        // rather than malforming it
        let mut data = mint_data_with_tlv_entries(&[(ExtensionType::TransferFeeConfig, 0)]);
        data.push(0);
        assert_matches_legacy_sizing(&data, &[]);
        assert!(try_calculate_account_len_from_mint_data(&crate::id(), &data, &[]).is_ok());
    }

    #[test]
    fn bytes_after_uninitialized_terminator_are_ignored() {
        // An `Uninitialized` entry terminates the walk, anything after it is never read
        let mut data = mint_data_with_tlv_entries(&[(ExtensionType::TransferFeeConfig, 0)]);
        data.extend_from_slice(&u16::from(ExtensionType::Uninitialized).to_le_bytes());
        data.extend_from_slice(&[0xff; 7]);
        assert_matches_legacy_sizing(&data, &[]);
        assert!(try_calculate_account_len_from_mint_data(&crate::id(), &data, &[]).is_ok());
    }

    #[test_case(ExtensionType::TransferFeeConfig; "mint extension")]
    #[test_case(ExtensionType::Uninitialized; "uninitialized")]
    fn rejects_non_account_additional_extension(extension_type: ExtensionType) {
        assert_eq!(
            try_calculate_account_len_from_mint_data(
                &crate::id(),
                TEST_MINT_SLICE,
                &[extension_type],
            ),
            Err(TokenError::ExtensionTypeMismatch.into()),
        );
    }

    #[test]
    fn rejects_wrong_token_program_id() {
        assert_eq!(
            try_calculate_account_len_from_mint_data(&Address::default(), TEST_MINT_SLICE, &[]),
            Err(ProgramError::IncorrectProgramId),
        );
    }

    #[test_case(
        vec![], &[ExtensionType::ImmutableOwner];
        "empty mint data"
    )]
    #[test_case(
        vec![0; Mint::LEN], &[];
        "uninitialized mint"
    )]
    #[test_case(
        {
            let mut data = mint_data_with_tlv_entries(&[]);
            data.resize(Multisig::LEN, 0);
            data
        },
        &[];
        "mint data of multisig len"
    )]
    fn rejects_invalid_mint_data(
        mint_data: Vec<u8>,
        additional_account_extensions: &[ExtensionType],
    ) {
        assert_matches_legacy_sizing(&mint_data, additional_account_extensions);
        assert_eq!(
            try_calculate_account_len_from_mint_data(
                &crate::id(),
                &mint_data,
                additional_account_extensions,
            ),
            Err(TokenError::InvalidMint.into()),
        );
    }

    #[test]
    fn truncated_tlv_entry_is_invalid_account_data() {
        // A type with only one byte after it cannot hold the entry's length
        let mut data = mint_data_with_tlv_entries(&[]);
        data.extend_from_slice(&u16::from(ExtensionType::TransferFeeConfig).to_le_bytes());
        data.push(0);
        assert_matches_legacy_sizing(&data, &[]);
        assert_eq!(
            try_calculate_account_len_from_mint_data(&crate::id(), &data, &[]),
            Err(ProgramError::InvalidAccountData),
        );
    }

    #[test]
    fn unknown_mint_extension_is_invalid_account_data() {
        let mut data = mint_data_with_tlv_entries(&[]);
        data.extend_from_slice(&999u16.to_le_bytes());
        data.extend_from_slice(&0u16.to_le_bytes());
        assert_matches_legacy_sizing(&data, &[]);
        assert_eq!(
            try_calculate_account_len_from_mint_data(&crate::id(), &data, &[]),
            Err(ProgramError::InvalidAccountData),
        );
    }

    #[test]
    fn seen_set_capacity_covers_every_account_extension_type() {
        assert!(all_account_extensions().len() <= SEEN_ACCOUNT_EXTENSIONS_CAPACITY);
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(1_000))]

        // Differential fuzz over well-formed mints, random TLV entries drawn from every extension
        // type with random declared value lengths
        #[test]
        fn arbitrary_mint_extension_lists_match_legacy_sizing(
            entries in prop::collection::vec(
                (
                    prop::sample::select(ExtensionType::iter().collect::<Vec<_>>()),
                    0usize..16,
                ),
                0..5,
            ),
            additional in prop::collection::vec(
                prop::sample::select(all_account_extensions()),
                0..12,
            ),
        ) {
            let mint_data = mint_data_with_tlv_entries(&entries);
            prop_assert_eq!(
                try_calculate_account_len_from_mint_data(&crate::id(), &mint_data, &additional),
                legacy_account_len(&mint_data, &additional),
            );
        }
    }
}
