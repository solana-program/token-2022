use {
    solana_account::Account as SolanaAccount,
    solana_hash::Hash,
    solana_keypair::Keypair,
    solana_program_pack::Pack,
    solana_program_test::{BanksClient, ProgramTest},
    solana_pubkey::Pubkey,
    solana_rent::Rent,
    solana_signer::Signer,
    solana_system_interface::instruction as system_instruction,
    solana_transaction::Transaction,
    solana_transaction_error::TransportError,
    spl_token_2022::{
        id, instruction,
        state::{Account, Mint},
    },
    token_whitelist_interface::state::SizeOf,
};

pub async fn create_mint(
    banks_client: &mut BanksClient,
    payer: &Keypair,
    recent_blockhash: Hash,
    pool_mint: &Keypair,
    manager: &Pubkey,
    decimals: u8,
) -> Result<(), TransportError> {
    let rent = banks_client.get_rent().await.unwrap();
    let mint_rent = rent.minimum_balance(Mint::LEN);

    let transaction = Transaction::new_signed_with_payer(
        &[
            system_instruction::create_account(
                &payer.pubkey(),
                &pool_mint.pubkey(),
                mint_rent,
                Mint::LEN as u64,
                &id(),
            ),
            instruction::initialize_mint(&id(), &pool_mint.pubkey(), manager, None, decimals)
                .unwrap(),
        ],
        Some(&payer.pubkey()),
        &[payer, pool_mint],
        recent_blockhash,
    );
    banks_client.process_transaction(transaction).await?;
    Ok(())
}

pub async fn create_account(
    banks_client: &mut BanksClient,
    payer: &Keypair,
    recent_blockhash: Hash,
    account: &Keypair,
    pool_mint: &Pubkey,
    owner: &Pubkey,
) -> Result<(), TransportError> {
    let rent = banks_client.get_rent().await.unwrap();
    let account_rent = rent.minimum_balance(Account::LEN);

    let transaction = Transaction::new_signed_with_payer(
        &[
            system_instruction::create_account(
                &payer.pubkey(),
                &account.pubkey(),
                account_rent,
                Account::LEN as u64,
                &id(),
            ),
            instruction::initialize_account(&id(), &account.pubkey(), pool_mint, owner).unwrap(),
        ],
        Some(&payer.pubkey()),
        &[payer, account],
        recent_blockhash,
    );
    banks_client.process_transaction(transaction).await?;
    Ok(())
}

pub async fn mint_to(
    banks_client: &mut BanksClient,
    payer: &Keypair,
    recent_blockhash: Hash,
    mint: &Pubkey,
    account: &Pubkey,
    mint_authority: &Keypair,
    whitelist_entry: &Pubkey,
    amount: u64,
) -> Result<(), TransportError> {
    let transaction = Transaction::new_signed_with_payer(
        &[instruction::mint_to(
            &id(),
            mint,
            account,
            &mint_authority.pubkey(),
            &whitelist_entry,
            &[],
            amount,
        )
        .unwrap()],
        Some(&payer.pubkey()),
        &[payer, mint_authority],
        recent_blockhash,
    );
    banks_client.process_transaction(transaction).await?;
    Ok(())
}

#[allow(deprecated)]
pub async fn transfer(
    banks_client: &mut BanksClient,
    payer: &Keypair,
    recent_blockhash: Hash,
    source: &Pubkey,
    destination: &Pubkey,
    authority: &Keypair,
    amount: u64,
) -> Result<(), TransportError> {
    let transaction = Transaction::new_signed_with_payer(
        &[
            instruction::transfer(&id(), source, destination, &authority.pubkey(), &[], amount)
                .unwrap(),
        ],
        Some(&payer.pubkey()),
        &[payer, authority],
        recent_blockhash,
    );
    banks_client.process_transaction(transaction).await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn transfer_checked(
    banks_client: &mut BanksClient,
    payer: &Keypair,
    recent_blockhash: Hash,
    source: &Pubkey,
    mint: &Pubkey,
    destination: &Pubkey,
    authority: &Keypair,
    amount: u64,
    decimals: u8,
) -> Result<(), TransportError> {
    let transaction = Transaction::new_signed_with_payer(
        &[instruction::transfer_checked(
            &id(),
            source,
            mint,
            destination,
            &authority.pubkey(),
            &[],
            amount,
            decimals,
        )
        .unwrap()],
        Some(&payer.pubkey()),
        &[payer, authority],
        recent_blockhash,
    );
    banks_client.process_transaction(transaction).await?;
    Ok(())
}

pub async fn burn(
    banks_client: &mut BanksClient,
    payer: &Keypair,
    recent_blockhash: Hash,
    mint: &Pubkey,
    account: &Pubkey,
    authority: &Keypair,
    amount: u64,
) -> Result<(), TransportError> {
    let transaction = Transaction::new_signed_with_payer(
        &[instruction::burn(&id(), account, mint, &authority.pubkey(), &[], amount).unwrap()],
        Some(&payer.pubkey()),
        &[payer, authority],
        recent_blockhash,
    );
    banks_client.process_transaction(transaction).await?;
    Ok(())
}

pub fn create_whitelist_entry(program_test: &mut ProgramTest, owner: &Pubkey) -> Pubkey {
    let (whitelist_entry_key, _) = Pubkey::find_program_address(
        &[
            &token_whitelist_interface::whitelist::id(),
            &owner.to_bytes(),
        ],
        &Pubkey::new_from_array(token_whitelist_interface::program::id()),
    );

    let mut whitelist_entry_account = SolanaAccount::new(
        Rent::default().minimum_balance(
            token_whitelist_interface::state::entry::WhitelistEntryAccount::SIZE_OF,
        ),
        token_whitelist_interface::state::entry::WhitelistEntryAccount::SIZE_OF,
        &Pubkey::new_from_array(token_whitelist_interface::program::id()),
    );

    whitelist_entry_account.data[0..32].copy_from_slice(&owner.to_bytes());
    whitelist_entry_account.data[32] =
        token_whitelist_interface::state::account_state::AccountState::Initialized as u8;

    program_test.add_account(whitelist_entry_key, whitelist_entry_account);

    whitelist_entry_key
}
