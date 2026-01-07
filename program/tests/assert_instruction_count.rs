mod setup;

use {
    mollusk_svm::{result::Check, Mollusk},
    solana_account::{Account as SolanaAccount, ReadableAccount},
    solana_program_pack::Pack,
    solana_pubkey::Pubkey,
    spl_token_2022_interface::{
        id, instruction,
        state::{Account, Mint},
    },
};

const TRANSFER_AMOUNT: u64 = 1_000_000_000_000_000;

#[test]
fn initialize_mint() {
    let mut mollusk = Mollusk::new(&id(), "spl_token_2022");
    mollusk.compute_budget.compute_unit_limit = 5_000; // last known 1322

    let owner = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let decimals = 9;

    let mint_account = {
        let space = Mint::LEN;
        let lamports = mollusk.sysvars.rent.minimum_balance(space);
        SolanaAccount::new(lamports, space, &id())
    };

    mollusk.process_and_validate_instruction(
        &instruction::initialize_mint(&id(), &mint, &owner, None, decimals).unwrap(),
        &[
            (mint, mint_account),
            mollusk.sysvars.keyed_account_for_rent_sysvar(),
        ],
        &[
            Check::success(),
            Check::account(&mint)
                .data(setup::setup_mint_account(Some(&owner), None, 0, decimals).data())
                .build(),
        ],
    );
}

#[test]
fn initialize_account() {
    let mut mollusk = Mollusk::new(&id(), "spl_token_2022");
    mollusk.compute_budget.compute_unit_limit = 6_000; // last known 1781

    let owner = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let account = Pubkey::new_unique();
    let decimals = 9;

    let mint_account = setup::setup_mint_account(None, None, 0, decimals);
    let token_account = {
        let space = Account::LEN;
        let lamports = mollusk.sysvars.rent.minimum_balance(space);
        SolanaAccount::new(lamports, space, &id())
    };

    mollusk.process_and_validate_instruction(
        &instruction::initialize_account(&id(), &account, &mint, &owner).unwrap(),
        &[
            (account, token_account),
            (mint, mint_account),
            (owner, SolanaAccount::default()),
            mollusk.sysvars.keyed_account_for_rent_sysvar(),
        ],
        &[
            Check::success(),
            Check::account(&account)
                .data(setup::setup_token_account(&mint, &owner, 0).data())
                .build(),
        ],
    );
}

#[test]
fn mint_to() {
    let mut mollusk = Mollusk::new(&id(), "spl_token_2022");
    mollusk.compute_budget.compute_unit_limit = 6_000; // last known 1230

    let owner = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let account = Pubkey::new_unique();
    let decimals = 9;

    let mint_account = setup::setup_mint_account(Some(&owner), None, 0, decimals);
    let token_account = setup::setup_token_account(&mint, &owner, 0);

    mollusk.process_and_validate_instruction(
        &instruction::mint_to(&id(), &mint, &account, &owner, &[], TRANSFER_AMOUNT).unwrap(),
        &[
            (mint, mint_account),
            (account, token_account),
            (owner, SolanaAccount::default()),
        ],
        &[
            Check::success(),
            Check::account(&mint)
                .data(
                    setup::setup_mint_account(Some(&owner), None, TRANSFER_AMOUNT, decimals).data(),
                )
                .build(),
            Check::account(&account)
                .data(setup::setup_token_account(&mint, &owner, TRANSFER_AMOUNT).data())
                .build(),
        ],
    );
}

#[test]
fn transfer() {
    let mut mollusk = Mollusk::new(&id(), "spl_token_2022");
    mollusk.compute_budget.compute_unit_limit = 7_000; // last known 1416

    let owner = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let source = Pubkey::new_unique();
    let destination = Pubkey::new_unique();

    let source_token_account = setup::setup_token_account(&mint, &owner, TRANSFER_AMOUNT);
    let destination_token_account = setup::setup_token_account(&mint, &owner, 0);

    mollusk.process_and_validate_instruction(
        #[allow(deprecated)]
        &instruction::transfer(&id(), &source, &destination, &owner, &[], TRANSFER_AMOUNT).unwrap(),
        &[
            (source, source_token_account),
            (destination, destination_token_account),
            (owner, SolanaAccount::default()),
        ],
        &[
            Check::success(),
            Check::account(&source)
                .data(setup::setup_token_account(&mint, &owner, 0).data())
                .build(),
            Check::account(&destination)
                .data(setup::setup_token_account(&mint, &owner, TRANSFER_AMOUNT).data())
                .build(),
        ],
    );
}

#[test]
fn transfer_checked() {
    let mut mollusk = Mollusk::new(&id(), "spl_token_2022");
    mollusk.compute_budget.compute_unit_limit = 7_000; // last known 1720

    let owner = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let source = Pubkey::new_unique();
    let destination = Pubkey::new_unique();
    let decimals = 9;

    let source_token_account = setup::setup_token_account(&mint, &owner, TRANSFER_AMOUNT);
    let mint_account = setup::setup_mint_account(None, None, TRANSFER_AMOUNT, decimals);
    let destination_token_account = setup::setup_token_account(&mint, &owner, 0);

    mollusk.process_and_validate_instruction(
        &instruction::transfer_checked(
            &id(),
            &source,
            &mint,
            &destination,
            &owner,
            &[],
            TRANSFER_AMOUNT,
            decimals,
        )
        .unwrap(),
        &[
            (source, source_token_account),
            (mint, mint_account),
            (destination, destination_token_account),
            (owner, SolanaAccount::default()),
        ],
        &[
            Check::success(),
            Check::account(&source)
                .data(setup::setup_token_account(&mint, &owner, 0).data())
                .build(),
            Check::account(&destination)
                .data(setup::setup_token_account(&mint, &owner, TRANSFER_AMOUNT).data())
                .build(),
        ],
    );
}

#[test]
fn burn() {
    let mut mollusk = Mollusk::new(&id(), "spl_token_2022");
    mollusk.compute_budget.compute_unit_limit = 6_000; // last known 1235

    let owner = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let account = Pubkey::new_unique();
    let decimals = 9;

    let mint_account = setup::setup_mint_account(None, None, TRANSFER_AMOUNT, decimals);
    let token_account = setup::setup_token_account(&mint, &owner, TRANSFER_AMOUNT);

    mollusk.process_and_validate_instruction(
        &instruction::burn(&id(), &account, &mint, &owner, &[], TRANSFER_AMOUNT).unwrap(),
        &[
            (mint, mint_account),
            (account, token_account),
            (owner, SolanaAccount::default()),
        ],
        &[
            Check::success(),
            Check::account(&account)
                .data(setup::setup_token_account(&mint, &owner, 0).data())
                .build(),
        ],
    );
}

#[test]
fn close_account() {
    let mut mollusk = Mollusk::new(&id(), "spl_token_2022");
    mollusk.compute_budget.compute_unit_limit = 6_000; // last known 1154

    let owner = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let account = Pubkey::new_unique();
    let decimals = 9;

    let mint_account = setup::setup_mint_account(None, None, 0, decimals);
    let token_account = setup::setup_token_account(&mint, &owner, 0);

    mollusk.process_and_validate_instruction(
        &instruction::close_account(&id(), &account, &owner, &owner, &[]).unwrap(),
        &[
            (mint, mint_account),
            (account, token_account),
            (owner, SolanaAccount::default()),
        ],
        &[Check::success(), Check::account(&account).closed().build()],
    );
}
