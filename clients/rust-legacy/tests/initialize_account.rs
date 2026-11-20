mod program_test;
use {
    program_test::TestContext,
    solana_program_test::tokio,
    solana_sdk::{
        account::Account as SolanaAccount,
        instruction::InstructionError,
        program_pack::Pack,
        pubkey::Pubkey,
        signature::Signer,
        signer::keypair::Keypair,
        transaction::{Transaction, TransactionError},
    },
    solana_system_interface::instruction as system_instruction,
    spl_token_2022_interface::{
        error::TokenError,
        extension::{
            transfer_fee::{self, TransferFeeAmount},
            AccountType, BaseStateWithExtensions, ExtensionType, StateWithExtensions,
        },
        instruction::{self, AuthorityType},
        state::{Account, Mint},
    },
};

#[tokio::test]
async fn no_extensions() {
    let context = TestContext::new().await;
    let ctx = context.context.lock().await;
    let rent = ctx.banks_client.get_rent().await.unwrap();
    let mint_account = Keypair::new();
    let mint_authority_pubkey = Pubkey::new_unique();

    let space = ExtensionType::try_calculate_account_len::<Mint>(&[]).unwrap();
    let instructions = vec![
        system_instruction::create_account(
            &ctx.payer.pubkey(),
            &mint_account.pubkey(),
            rent.minimum_balance(space),
            space as u64,
            &spl_token_2022_interface::id(),
        ),
        instruction::initialize_mint(
            &spl_token_2022_interface::id(),
            &mint_account.pubkey(),
            &mint_authority_pubkey,
            None,
            9,
        )
        .unwrap(),
    ];
    let tx = Transaction::new_signed_with_payer(
        &instructions,
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer, &mint_account],
        ctx.last_blockhash,
    );
    ctx.banks_client.process_transaction(tx).await.unwrap();

    let account = Keypair::new();
    let account_owner_pubkey = Pubkey::new_unique();
    let space = ExtensionType::try_calculate_account_len::<Account>(&[]).unwrap();
    let instructions = vec![
        system_instruction::create_account(
            &ctx.payer.pubkey(),
            &account.pubkey(),
            rent.minimum_balance(space),
            space as u64,
            &spl_token_2022_interface::id(),
        ),
        instruction::initialize_account3(
            &spl_token_2022_interface::id(),
            &account.pubkey(),
            &mint_account.pubkey(),
            &account_owner_pubkey,
        )
        .unwrap(),
    ];
    let tx = Transaction::new_signed_with_payer(
        &instructions,
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer, &account],
        ctx.last_blockhash,
    );
    ctx.banks_client.process_transaction(tx).await.unwrap();
    let account_info = ctx
        .banks_client
        .get_account(account.pubkey())
        .await
        .expect("get_account")
        .expect("account not none");
    assert_eq!(
        account_info.data.len(),
        spl_token_2022_interface::state::Account::LEN
    );
    assert_eq!(account_info.owner, spl_token_2022_interface::id());
    assert_eq!(account_info.lamports, rent.minimum_balance(space));
}

#[tokio::test]
async fn fail_on_invalid_mint() {
    let context = TestContext::new().await;
    let ctx = context.context.lock().await;
    let rent = ctx.banks_client.get_rent().await.unwrap();
    let mint_account = Keypair::new();

    let space = ExtensionType::try_calculate_account_len::<Mint>(&[]).unwrap();
    let instructions = vec![system_instruction::create_account(
        &ctx.payer.pubkey(),
        &mint_account.pubkey(),
        rent.minimum_balance(space),
        space as u64,
        &spl_token_2022_interface::id(),
    )];
    let tx = Transaction::new_signed_with_payer(
        &instructions,
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer, &mint_account],
        ctx.last_blockhash,
    );
    ctx.banks_client.process_transaction(tx).await.unwrap();

    let account = Keypair::new();
    let account_owner_pubkey = Pubkey::new_unique();
    let space = ExtensionType::try_calculate_account_len::<Account>(&[]).unwrap();
    let instructions = vec![
        system_instruction::create_account(
            &ctx.payer.pubkey(),
            &account.pubkey(),
            rent.minimum_balance(space),
            space as u64,
            &spl_token_2022_interface::id(),
        ),
        instruction::initialize_account3(
            &spl_token_2022_interface::id(),
            &account.pubkey(),
            &mint_account.pubkey(),
            &account_owner_pubkey,
        )
        .unwrap(),
    ];
    let tx = Transaction::new_signed_with_payer(
        &instructions,
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer, &account],
        ctx.last_blockhash,
    );
    let err = ctx
        .banks_client
        .process_transaction(tx)
        .await
        .unwrap_err()
        .unwrap();
    assert_eq!(
        err,
        TransactionError::InstructionError(
            1,
            InstructionError::Custom(TokenError::InvalidMint as u32)
        )
    );
}

#[tokio::test]
async fn single_extension() {
    let context = TestContext::new().await;
    let ctx = context.context.lock().await;
    let rent = ctx.banks_client.get_rent().await.unwrap();
    let mint_account = Keypair::new();
    let mint_authority_pubkey = Pubkey::new_unique();

    let space =
        ExtensionType::try_calculate_account_len::<Mint>(&[ExtensionType::TransferFeeConfig])
            .unwrap();
    let instructions = vec![
        system_instruction::create_account(
            &ctx.payer.pubkey(),
            &mint_account.pubkey(),
            rent.minimum_balance(space),
            space as u64,
            &spl_token_2022_interface::id(),
        ),
        transfer_fee::instruction::initialize_transfer_fee_config(
            &spl_token_2022_interface::id(),
            &mint_account.pubkey(),
            None,
            None,
            10,
            4242,
        )
        .unwrap(),
        instruction::initialize_mint(
            &spl_token_2022_interface::id(),
            &mint_account.pubkey(),
            &mint_authority_pubkey,
            None,
            9,
        )
        .unwrap(),
    ];
    let tx = Transaction::new_signed_with_payer(
        &instructions,
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer, &mint_account],
        ctx.last_blockhash,
    );
    ctx.banks_client.process_transaction(tx).await.unwrap();

    let account = Keypair::new();
    let account_owner_pubkey = Pubkey::new_unique();
    let space =
        ExtensionType::try_calculate_account_len::<Account>(&[ExtensionType::TransferFeeAmount])
            .unwrap();
    let instructions = vec![
        system_instruction::create_account(
            &ctx.payer.pubkey(),
            &account.pubkey(),
            rent.minimum_balance(space),
            space as u64,
            &spl_token_2022_interface::id(),
        ),
        instruction::initialize_account3(
            &spl_token_2022_interface::id(),
            &account.pubkey(),
            &mint_account.pubkey(),
            &account_owner_pubkey,
        )
        .unwrap(),
    ];
    let tx = Transaction::new_signed_with_payer(
        &instructions,
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer, &account],
        ctx.last_blockhash,
    );
    ctx.banks_client.process_transaction(tx).await.unwrap();
    let account_info = ctx
        .banks_client
        .get_account(account.pubkey())
        .await
        .expect("get_account")
        .expect("account not none");
    assert_eq!(
        account_info.data.len(),
        ExtensionType::try_calculate_account_len::<Account>(&[ExtensionType::TransferFeeAmount])
            .unwrap(),
    );
    assert_eq!(account_info.owner, spl_token_2022_interface::id());
    assert_eq!(account_info.lamports, rent.minimum_balance(space));
    let state = StateWithExtensions::<Account>::unpack(&account_info.data).unwrap();
    assert_eq!(state.base.mint, mint_account.pubkey());
    assert_eq!(
        &state.get_extension_types().unwrap(),
        &[ExtensionType::TransferFeeAmount]
    );
    let unpacked_extension = state.get_extension::<TransferFeeAmount>().unwrap();
    assert_eq!(
        *unpacked_extension,
        TransferFeeAmount {
            withheld_amount: 0.into()
        }
    );
}

// TODO: add test for multiple Account extensions when memo extension is present

const PERMANENT_DELEGATE_WARNING: &str =
    "Warning: Mint has a permanent delegate, so tokens in this account may be seized at any time";

/// Simulates `InitializeAccount3` for a mint with a permanent delegate and returns its logs
async fn initialize_account3_logs(clear_permanent_delegate: bool) -> Vec<String> {
    let context = TestContext::new().await;
    let ctx = context.context.lock().await;
    let rent = ctx.banks_client.get_rent().await.unwrap();
    let program_id = spl_token_2022_interface::id();
    let mint_account = Keypair::new();
    let delegate = Keypair::new();

    let space =
        ExtensionType::try_calculate_account_len::<Mint>(&[ExtensionType::PermanentDelegate])
            .unwrap();
    let mut instructions = vec![
        system_instruction::create_account(
            &ctx.payer.pubkey(),
            &mint_account.pubkey(),
            rent.minimum_balance(space),
            space as u64,
            &program_id,
        ),
        instruction::initialize_permanent_delegate(
            &program_id,
            &mint_account.pubkey(),
            &delegate.pubkey(),
        )
        .unwrap(),
        instruction::initialize_mint(
            &program_id,
            &mint_account.pubkey(),
            &Pubkey::new_unique(),
            None,
            9,
        )
        .unwrap(),
    ];
    let mut signers = vec![&ctx.payer, &mint_account];
    if clear_permanent_delegate {
        instructions.push(
            instruction::set_authority(
                &program_id,
                &mint_account.pubkey(),
                None,
                AuthorityType::PermanentDelegate,
                &delegate.pubkey(),
                &[],
            )
            .unwrap(),
        );
        signers.push(&delegate);
    }
    let tx = Transaction::new_signed_with_payer(
        &instructions,
        Some(&ctx.payer.pubkey()),
        signers.as_slice(),
        ctx.last_blockhash,
    );
    ctx.banks_client.process_transaction(tx).await.unwrap();

    let account = Keypair::new();
    let space = ExtensionType::try_calculate_account_len::<Account>(&[]).unwrap();
    let instructions = [
        system_instruction::create_account(
            &ctx.payer.pubkey(),
            &account.pubkey(),
            rent.minimum_balance(space),
            space as u64,
            &program_id,
        ),
        instruction::initialize_account3(
            &program_id,
            &account.pubkey(),
            &mint_account.pubkey(),
            &Pubkey::new_unique(),
        )
        .unwrap(),
    ];
    let tx = Transaction::new_signed_with_payer(
        &instructions,
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer, &account],
        ctx.last_blockhash,
    );
    let simulation = ctx.banks_client.simulate_transaction(tx).await.unwrap();
    assert_eq!(simulation.result, Some(Ok(())));
    simulation.simulation_details.unwrap().logs
}

#[tokio::test]
async fn permanent_delegate_warning_is_logged() {
    let logs = initialize_account3_logs(false).await;
    assert!(logs
        .iter()
        .any(|log| log.ends_with(PERMANENT_DELEGATE_WARNING)));
}

#[tokio::test]
async fn cleared_permanent_delegate_is_not_logged() {
    let logs = initialize_account3_logs(true).await;
    assert!(!logs
        .iter()
        .any(|log| log.ends_with(PERMANENT_DELEGATE_WARNING)));
}

fn unknown_tag_then_permanent_delegate(delegate: [u8; 32]) -> Vec<u8> {
    [
        &999u16.to_le_bytes()[..],
        &0u16.to_le_bytes(),
        &u16::from(ExtensionType::PermanentDelegate).to_le_bytes(),
        &32u16.to_le_bytes(),
        &delegate,
    ]
    .concat()
}

async fn simulate_initialize_account3_with_raw_mint_tlv(
    mint_tlv_data: &[u8],
) -> (Option<Result<(), TransactionError>>, Vec<String>) {
    let context = TestContext::new().await;
    let mut ctx = context.context.lock().await;
    let rent = ctx.banks_client.get_rent().await.unwrap();
    let program_id = spl_token_2022_interface::id();

    let mut mint_data = vec![0; Account::LEN];
    Mint {
        decimals: 9,
        is_initialized: true,
        ..Mint::default()
    }
    .pack_into_slice(&mut mint_data[..Mint::LEN]);
    mint_data.push(AccountType::Mint.into());
    mint_data.extend_from_slice(mint_tlv_data);
    let mint = Pubkey::new_unique();
    ctx.set_account(
        &mint,
        &SolanaAccount {
            lamports: rent.minimum_balance(mint_data.len()),
            data: mint_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        }
        .into(),
    );

    let account = Keypair::new();
    let instructions = [
        system_instruction::create_account(
            &ctx.payer.pubkey(),
            &account.pubkey(),
            rent.minimum_balance(Account::LEN),
            Account::LEN as u64,
            &program_id,
        ),
        instruction::initialize_account3(
            &program_id,
            &account.pubkey(),
            &mint,
            &Pubkey::new_unique(),
        )
        .unwrap(),
    ];
    let tx = Transaction::new_signed_with_payer(
        &instructions,
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer, &account],
        ctx.last_blockhash,
    );
    let simulation = ctx.banks_client.simulate_transaction(tx).await.unwrap();
    (
        simulation.result,
        simulation.simulation_details.unwrap().logs,
    )
}

const INVALID_ACCOUNT_DATA: Option<Result<(), TransactionError>> = Some(Err(
    TransactionError::InstructionError(1, InstructionError::InvalidAccountData),
));

#[tokio::test]
async fn permanent_delegate_warning_precedes_unknown_tag_rejection() {
    let (result, logs) = simulate_initialize_account3_with_raw_mint_tlv(
        &unknown_tag_then_permanent_delegate([7; 32]),
    )
    .await;
    assert_eq!(result, INVALID_ACCOUNT_DATA);
    let warning = logs
        .iter()
        .position(|log| log.ends_with(PERMANENT_DELEGATE_WARNING))
        .expect("permanent delegate warning");
    let failure = logs
        .iter()
        .position(|log| log.contains(" failed: "))
        .expect("instruction failure");
    assert!(warning < failure);
}

#[tokio::test]
async fn cleared_permanent_delegate_after_unknown_tag_is_not_logged() {
    let (result, logs) = simulate_initialize_account3_with_raw_mint_tlv(
        &unknown_tag_then_permanent_delegate([0; 32]),
    )
    .await;
    assert_eq!(result, INVALID_ACCOUNT_DATA);
    assert!(!logs
        .iter()
        .any(|log| log.ends_with(PERMANENT_DELEGATE_WARNING)));
}
