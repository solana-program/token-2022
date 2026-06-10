use {
    super::{
        try_for_each_tlv_extension_type, AccountType, BaseStateWithExtensions, ExtensionType,
        PodStateWithExtensions,
    },
    crate::{error::TokenError, pod::PodMint, state::Account},
    solana_program_error::ProgramError,
};

/// Must stay at or above the total number of `ExtensionType`s that exist, which is verified
/// by the capacity test in this module
pub(crate) const EXTENSION_TYPE_BUFFER_CAPACITY: usize = 50;

/// A fixed-capacity unique list of extension types. A no-alloc version of a set.
#[derive(Debug)]
pub(crate) struct ExtensionTypeBuffer {
    /// The recorded extension types, filled from the front. Slots past `count` are unused
    /// and hold `Uninitialized` as filler
    types: [ExtensionType; EXTENSION_TYPE_BUFFER_CAPACITY],
    /// How many slots are occupied
    count: usize,
}

impl Default for ExtensionTypeBuffer {
    fn default() -> Self {
        Self {
            types: [ExtensionType::Uninitialized; EXTENSION_TYPE_BUFFER_CAPACITY],
            count: 0,
        }
    }
}

impl ExtensionTypeBuffer {
    /// Records the extension type unless it is already present
    pub(crate) fn insert(&mut self, extension_type: ExtensionType) -> Result<(), ProgramError> {
        if self.types().contains(&extension_type) {
            return Ok(());
        }

        // Not seen, so take the next free slot
        let slot = self
            .types
            .get_mut(self.count)
            .ok_or(ProgramError::InvalidAccountData)?;
        *slot = extension_type;
        self.count = self.count.saturating_add(1);

        Ok(())
    }

    /// The recorded extension types in insertion order
    pub(crate) fn types(&self) -> &[ExtensionType] {
        &self.types[..self.count]
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

    // Collect the account extensions the mint requires
    let mut account_extensions = ExtensionTypeBuffer::default();
    try_for_each_required_init_account_extension(state.get_tlv_data(), |extension_type| {
        account_extensions.insert(extension_type)
    })?;

    // Add the requested ones. `insert` dedupes, so overlap with the required
    // extensions is only sized once.
    for &extension_type in additional_account_extensions {
        account_extensions.insert(extension_type)?;
    }

    ExtensionType::try_calculate_account_len::<Account>(account_extensions.types())
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
        mint_data_with_tlv_entries(&[(ExtensionType::ImmutableOwner, 0)]), &[],
        Account::SIZE_OF;
        "account extension inside mint tlv"
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
        mint_data_with_tlv_entries(&[
            (ExtensionType::NonTransferable, 0),
            (ExtensionType::NonTransferable, 0),
        ]),
        &[],
        174;
        "duplicate mint extensions"
    )]
    #[test_case(
        mint_data_with_tlv_entries(&[(ExtensionType::TransferFeeConfig, 5)]), &[],
        178;
        "declared tlv value length is ignored"
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
        {
            let mut data = mint_data_with_tlv_entries(&[(ExtensionType::TransferFeeConfig, 0)]);
            data.extend_from_slice(&u16::from(ExtensionType::Uninitialized).to_le_bytes());
            data.extend_from_slice(&[0xff; 7]);
            data
        },
        &[],
        178;
        "bytes after uninitialized terminator are ignored"
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
    fn buffer_holds_every_extension_type_once() {
        let mut buffer = ExtensionTypeBuffer::default();
        for _ in 0..2 {
            for extension_type in ExtensionType::iter() {
                buffer.insert(extension_type).unwrap();
            }
        }
        assert_eq!(buffer.types().len(), ExtensionType::iter().count());
    }
}
