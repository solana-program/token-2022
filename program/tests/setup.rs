use {
    solana_account::Account as SolanaAccount,
    solana_address::Address,
    solana_program_pack::Pack,
    solana_rent::Rent,
    spl_token_2022_interface::{
        extension::{
            default_account_state::DefaultAccountState, metadata_pointer::MetadataPointer,
            permanent_delegate::PermanentDelegate, transfer_fee::TransferFeeConfig,
            BaseStateWithExtensionsMut, ExtensionType, PodStateWithExtensionsMut,
        },
        pod::{PodAccount, PodMint},
        state::{Account, AccountState, Mint},
    },
};

pub fn setup_mint_account(
    mint_authority: Option<&Address>,
    freeze_authority: Option<&Address>,
    supply: u64,
    decimals: u8,
) -> SolanaAccount {
    let data = {
        let mut data = vec![0; Mint::LEN];
        let state = Mint {
            mint_authority: mint_authority.cloned().into(),
            supply,
            decimals,
            is_initialized: true,
            freeze_authority: freeze_authority.cloned().into(),
        };
        state.pack_into_slice(&mut data);
        data
    };

    let space = data.len();
    let lamports = Rent::default().minimum_balance(space);

    SolanaAccount {
        lamports,
        data,
        owner: spl_token_2022_interface::id(),
        ..Default::default()
    }
}

pub fn setup_token_account(mint: &Address, owner: &Address, amount: u64) -> SolanaAccount {
    let data = {
        let mut data = vec![0; Account::LEN];
        let state = Account {
            mint: *mint,
            owner: *owner,
            amount,
            delegate: None.into(),
            state: AccountState::Initialized,
            is_native: None.into(),
            delegated_amount: 0,
            close_authority: None.into(),
        };
        state.pack_into_slice(&mut data);
        data
    };

    let space = data.len();
    let lamports = Rent::default().minimum_balance(space);

    SolanaAccount {
        lamports,
        data,
        owner: spl_token_2022_interface::id(),
        ..Default::default()
    }
}

/// An initialized mint carrying `TransferFeeConfig`, `MetadataPointer`, `PermanentDelegate`
/// and `DefaultAccountState`, in that TLV order
#[allow(dead_code)]
pub fn setup_extended_mint_account(
    decimals: u8,
    permanent_delegate: &Address,
    default_state: AccountState,
) -> SolanaAccount {
    let space = ExtensionType::try_calculate_account_len::<Mint>(&[
        ExtensionType::TransferFeeConfig,
        ExtensionType::MetadataPointer,
        ExtensionType::PermanentDelegate,
        ExtensionType::DefaultAccountState,
    ])
    .unwrap();
    let mut data = vec![0; space];
    let mut mint = PodStateWithExtensionsMut::<PodMint>::unpack_uninitialized(&mut data).unwrap();
    mint.init_extension::<TransferFeeConfig>(true).unwrap();
    mint.init_extension::<MetadataPointer>(true).unwrap();
    mint.init_extension::<PermanentDelegate>(true)
        .unwrap()
        .delegate = Some(*permanent_delegate).try_into().unwrap();
    mint.init_extension::<DefaultAccountState>(true)
        .unwrap()
        .state = default_state.into();
    mint.base.decimals = decimals;
    mint.base.is_initialized = true.into();
    mint.init_account_type().unwrap();

    SolanaAccount {
        lamports: Rent::default().minimum_balance(space),
        data,
        owner: spl_token_2022_interface::id(),
        ..Default::default()
    }
}

/// The data `InitializeAccount` produces for a non-native account with the given extensions
#[allow(dead_code)]
pub fn setup_token_account_data(
    mint: &Address,
    owner: &Address,
    state: AccountState,
    extension_types: &[ExtensionType],
) -> Vec<u8> {
    let space = ExtensionType::try_calculate_account_len::<Account>(extension_types).unwrap();
    let mut data = vec![0; space];
    let mut account =
        PodStateWithExtensionsMut::<PodAccount>::unpack_uninitialized(&mut data).unwrap();
    for &extension_type in extension_types {
        account
            .init_account_extension_from_type(extension_type)
            .unwrap();
    }
    account.base.mint = *mint;
    account.base.owner = *owner;
    account.base.state = state.into();
    account.init_account_type().unwrap();
    data
}
