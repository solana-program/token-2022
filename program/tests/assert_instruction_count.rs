#![cfg(feature = "test-sbf")]

mod action;
use {
    solana_keypair::Keypair,
    solana_program_pack::Pack,
    solana_program_test::{processor, tokio, ProgramTest},
    solana_pubkey::Pubkey,
    solana_signer::Signer,
    solana_system_interface::instruction as system_instruction,
    solana_transaction::Transaction,
    spl_token_2022::{
        id, instruction,
        processor::Processor,
        state::{Account, Mint},
    },
};

const TRANSFER_AMOUNT: u64 = 1_000_000_000_000_000;

#[tokio::test]
async fn initialize_mint() {
    let mut pt = ProgramTest::new("spl_token_2022", id(), processor!(Processor::process));
    pt.set_compute_max_units(5_000); // last known 1401
    let (banks_client, payer, recent_blockhash) = pt.start().await;

    let owner_key = Pubkey::new_unique();
    let mint = Keypair::new();
    let decimals = 9;

    let rent = banks_client.get_rent().await.unwrap();
    let mint_rent = rent.minimum_balance(Mint::LEN);
    let transaction = Transaction::new_signed_with_payer(
        &[system_instruction::create_account(
            &payer.pubkey(),
            &mint.pubkey(),
            mint_rent,
            Mint::LEN as u64,
            &id(),
        )],
        Some(&payer.pubkey()),
        &[&payer, &mint],
        recent_blockhash,
    );
    banks_client.process_transaction(transaction).await.unwrap();

    let transaction = Transaction::new_signed_with_payer(
        &[
            instruction::initialize_mint(&id(), &mint.pubkey(), &owner_key, None, decimals)
                .unwrap(),
        ],
        Some(&payer.pubkey()),
        &[&payer],
        recent_blockhash,
    );
    banks_client.process_transaction(transaction).await.unwrap();
}

#[tokio::test]
async fn initialize_account() {
    let mut pt = ProgramTest::new("spl_token_2022", id(), processor!(Processor::process));
    pt.set_compute_max_units(8_000); // last known 1620
    let (mut banks_client, payer, recent_blockhash) = pt.start().await;

    let owner = Keypair::new();
    let mint = Keypair::new();
    let account = Keypair::new();
    let decimals = 9;

    action::create_mint(
        &mut banks_client,
        &payer,
        recent_blockhash,
        &mint,
        &owner.pubkey(),
        decimals,
    )
    .await
    .unwrap();
    let rent = banks_client.get_rent().await.unwrap();
    let account_rent = rent.minimum_balance(Account::LEN);
    let transaction = Transaction::new_signed_with_payer(
        &[system_instruction::create_account(
            &payer.pubkey(),
            &account.pubkey(),
            account_rent,
            Account::LEN as u64,
            &id(),
        )],
        Some(&payer.pubkey()),
        &[&payer, &account],
        recent_blockhash,
    );
    banks_client.process_transaction(transaction).await.unwrap();

    let transaction = Transaction::new_signed_with_payer(
        &[instruction::initialize_account(
            &id(),
            &account.pubkey(),
            &mint.pubkey(),
            &owner.pubkey(),
        )
        .unwrap()],
        Some(&payer.pubkey()),
        &[&payer],
        recent_blockhash,
    );
    banks_client.process_transaction(transaction).await.unwrap();
}

#[tokio::test]
async fn mint_to() {
    let mut pt = ProgramTest::new("spl_token_2022", id(), processor!(Processor::process));
    pt.set_compute_max_units(8_000); // last known 967
    let (mut banks_client, payer, recent_blockhash) = pt.start().await;

    let owner = Keypair::new();
    let mint = Keypair::new();
    let account = Keypair::new();
    let decimals = 9;

    action::create_mint(
        &mut banks_client,
        &payer,
        recent_blockhash,
        &mint,
        &owner.pubkey(),
        decimals,
    )
    .await
    .unwrap();
    action::create_account(
        &mut banks_client,
        &payer,
        recent_blockhash,
        &account,
        &mint.pubkey(),
        &owner.pubkey(),
    )
    .await
    .unwrap();

    let transaction = Transaction::new_signed_with_payer(
        &[instruction::mint_to(
            &id(),
            &mint.pubkey(),
            &account.pubkey(),
            &owner.pubkey(),
            &[],
            TRANSFER_AMOUNT,
        )
        .unwrap()],
        Some(&payer.pubkey()),
        &[&payer, &owner],
        recent_blockhash,
    );
    banks_client.process_transaction(transaction).await.unwrap();
}

#[tokio::test]
async fn transfer() {
    let mut pt = ProgramTest::new("spl_token_2022", id(), processor!(Processor::process));
    pt.set_compute_max_units(8_000); // last known 1222
    let (mut banks_client, payer, recent_blockhash) = pt.start().await;

    let owner = Keypair::new();
    let mint = Keypair::new();
    let source = Keypair::new();
    let destination = Keypair::new();
    let decimals = 9;

    action::create_mint(
        &mut banks_client,
        &payer,
        recent_blockhash,
        &mint,
        &owner.pubkey(),
        decimals,
    )
    .await
    .unwrap();
    action::create_account(
        &mut banks_client,
        &payer,
        recent_blockhash,
        &source,
        &mint.pubkey(),
        &owner.pubkey(),
    )
    .await
    .unwrap();
    action::create_account(
        &mut banks_client,
        &payer,
        recent_blockhash,
        &destination,
        &mint.pubkey(),
        &owner.pubkey(),
    )
    .await
    .unwrap();

    action::mint_to(
        &mut banks_client,
        &payer,
        recent_blockhash,
        &mint.pubkey(),
        &source.pubkey(),
        &owner,
        TRANSFER_AMOUNT,
    )
    .await
    .unwrap();

    action::transfer(
        &mut banks_client,
        &payer,
        recent_blockhash,
        &source.pubkey(),
        &destination.pubkey(),
        &owner,
        TRANSFER_AMOUNT,
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn transfer_checked() {
    let mut pt = ProgramTest::new("spl_token_2022", id(), processor!(Processor::process));
    pt.set_compute_max_units(8_000); // last known 1516
    let (mut banks_client, payer, recent_blockhash) = pt.start().await;

    let owner = Keypair::new();
    let mint = Keypair::new();
    let source = Keypair::new();
    let destination = Keypair::new();
    let decimals = 9;

    action::create_mint(
        &mut banks_client,
        &payer,
        recent_blockhash,
        &mint,
        &owner.pubkey(),
        decimals,
    )
    .await
    .unwrap();
    action::create_account(
        &mut banks_client,
        &payer,
        recent_blockhash,
        &source,
        &mint.pubkey(),
        &owner.pubkey(),
    )
    .await
    .unwrap();
    action::create_account(
        &mut banks_client,
        &payer,
        recent_blockhash,
        &destination,
        &mint.pubkey(),
        &owner.pubkey(),
    )
    .await
    .unwrap();

    action::mint_to(
        &mut banks_client,
        &payer,
        recent_blockhash,
        &mint.pubkey(),
        &source.pubkey(),
        &owner,
        TRANSFER_AMOUNT,
    )
    .await
    .unwrap();

    action::transfer_checked(
        &mut banks_client,
        &payer,
        recent_blockhash,
        &source.pubkey(),
        &mint.pubkey(),
        &destination.pubkey(),
        &owner,
        TRANSFER_AMOUNT,
        decimals,
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn burn() {
    let mut pt = ProgramTest::new("spl_token_2022", id(), processor!(Processor::process));
    pt.set_compute_max_units(8_000); // last known 1070
    let (mut banks_client, payer, recent_blockhash) = pt.start().await;

    let owner = Keypair::new();
    let mint = Keypair::new();
    let account = Keypair::new();
    let decimals = 9;

    action::create_mint(
        &mut banks_client,
        &payer,
        recent_blockhash,
        &mint,
        &owner.pubkey(),
        decimals,
    )
    .await
    .unwrap();
    action::create_account(
        &mut banks_client,
        &payer,
        recent_blockhash,
        &account,
        &mint.pubkey(),
        &owner.pubkey(),
    )
    .await
    .unwrap();

    action::mint_to(
        &mut banks_client,
        &payer,
        recent_blockhash,
        &mint.pubkey(),
        &account.pubkey(),
        &owner,
        TRANSFER_AMOUNT,
    )
    .await
    .unwrap();

    action::burn(
        &mut banks_client,
        &payer,
        recent_blockhash,
        &mint.pubkey(),
        &account.pubkey(),
        &owner,
        TRANSFER_AMOUNT,
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn close_account() {
    let mut pt = ProgramTest::new("spl_token_2022", id(), processor!(Processor::process));
    pt.set_compute_max_units(8_000); // last known 1111
    let (mut banks_client, payer, recent_blockhash) = pt.start().await;

    let owner = Keypair::new();
    let mint = Keypair::new();
    let account = Keypair::new();
    let decimals = 9;

    action::create_mint(
        &mut banks_client,
        &payer,
        recent_blockhash,
        &mint,
        &owner.pubkey(),
        decimals,
    )
    .await
    .unwrap();
    action::create_account(
        &mut banks_client,
        &payer,
        recent_blockhash,
        &account,
        &mint.pubkey(),
        &owner.pubkey(),
    )
    .await
    .unwrap();

    let transaction = Transaction::new_signed_with_payer(
        &[instruction::close_account(
            &id(),
            &account.pubkey(),
            &owner.pubkey(),
            &owner.pubkey(),
            &[],
        )
        .unwrap()],
        Some(&payer.pubkey()),
        &[&payer, &owner],
        recent_blockhash,
    );
    banks_client.process_transaction(transaction).await.unwrap();
}
