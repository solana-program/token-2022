mod program_test;
use {
    program_test::{TestContext, TokenContext},
    solana_program_test::tokio,
    solana_sdk::{
        instruction::InstructionError, pubkey::Pubkey, signature::Signer, signer::keypair::Keypair,
        transaction::TransactionError, transport::TransportError,
    },
    spl_associated_token_account_interface::address::get_associated_token_address_with_program_id,
    spl_token_2022_interface::{
        error::TokenError,
        extension::{
            slot_reference_fee::{
                instruction as srf_instruction, SlotReferenceFeeAmount, SlotReferenceFeeConfig,
            },
            BaseStateWithExtensions,
        },
        id,
        instruction::AuthorityType,
    },
    spl_token_client::{
        client::ProgramBanksClientProcessTransaction,
        token::{ExtensionInitializationParams, Token, TokenError as TokenClientError},
    },
};

const FLOOR_BPS: u16 = 10;
const CAP_BPS: u16 = 10_000;
const FREE_REFS: u16 = 2;
const SLOW_FLOOR_BPS: u16 = 2;
const SLOW_CAP_BPS: u16 = 1_000;
const SLOW_FREE_REFS: u16 = 1;
const SLOW_WINDOW: u64 = 1_280;
const LOCKUP_EPOCH: u64 = 900;
const SUPPLY: u64 = 1_000_000_000;

struct Fixture {
    context: TestContext,
    authority: Keypair,
    /// withdraw authority the stake destination carries
    stake_withdrawer: Keypair,
    /// the stake account fees are staked into
    fee_destination: Pubkey,
    /// the settler's authority and its token account
    settler: Keypair,
    settler_account: Pubkey,
    alice_account: Pubkey,
    bob_account: Pubkey,
}

/// Bytes of an `Initialized` `StakeStateV2`: tag 1, then Meta with the given
/// withdrawer and lockup epoch. Enough for the program's check.
fn stake_account_data(withdrawer: &Pubkey, lockup_epoch: u64) -> Vec<u8> {
    let mut data = vec![0u8; 200];
    data[0..4].copy_from_slice(&1u32.to_le_bytes());
    data[12..44].copy_from_slice(withdrawer.as_ref()); // staker
    data[44..76].copy_from_slice(withdrawer.as_ref()); // withdrawer
    data[84..92].copy_from_slice(&lockup_epoch.to_le_bytes());
    data
}

/// Put a stake-program-owned account on the ledger.
async fn plant_stake_account(
    context: &TestContext,
    withdrawer: &Pubkey,
    lockup_epoch: u64,
) -> Pubkey {
    let key = Pubkey::new_unique();
    let mut ctx = context.context.lock().await;
    ctx.set_account(
        &key,
        &solana_sdk::account::Account {
            lamports: 10_000_000_000,
            data: stake_account_data(withdrawer, lockup_epoch),
            owner: solana_sdk_ids::stake::id(),
            executable: false,
            rent_epoch: 0,
        }
        .into(),
    );
    key
}

/// Error of the only token instruction in a `process_ixs` transaction.
fn custom(err: TokenError) -> TokenClientError {
    custom_at(0, err)
}

/// Error of the token instruction at `index` in a transaction.
fn custom_at(index: u8, err: TokenError) -> TokenClientError {
    TokenClientError::Client(Box::new(TransportError::TransactionError(
        TransactionError::InstructionError(index, InstructionError::Custom(err as u32)),
    )))
}

async fn setup_with(
    lockup_epoch: u64,
    stake_lockup_epoch: u64,
) -> Result<Fixture, TokenClientError> {
    let mut context = TestContext::new().await;
    let mint = Keypair::new();
    let authority = Keypair::new();
    let stake_withdrawer = Keypair::new();
    let settler = Keypair::new();
    // the fee destination is a stake account, so it exists before the mint does
    let fee_destination =
        plant_stake_account(&context, &stake_withdrawer.pubkey(), lockup_epoch).await;
    let settler_account =
        get_associated_token_address_with_program_id(&settler.pubkey(), &mint.pubkey(), &id());
    context
        .init_token_with_mint_keypair_and_freeze_authority(
            mint,
            vec![ExtensionInitializationParams::SlotReferenceFeeConfig {
                authority: Some(authority.pubkey()),
                fee_destination,
                settler: settler.pubkey(),
                floor_basis_points: FLOOR_BPS,
                cap_basis_points: CAP_BPS,
                free_references: FREE_REFS,
                slow_floor_basis_points: SLOW_FLOOR_BPS,
                slow_cap_basis_points: SLOW_CAP_BPS,
                slow_free_references: SLOW_FREE_REFS,
                slow_window_slots: SLOW_WINDOW,
                stake_withdrawer: stake_withdrawer.pubkey(),
                stake_lockup_epoch,
            }],
            None,
        )
        .await?;

    let TokenContext {
        token,
        alice,
        bob,
        mint_authority,
        ..
    } = context.token_context.as_ref().unwrap();

    token
        .create_associated_token_account(&settler.pubkey())
        .await
        .unwrap();

    let alice_keypair = Keypair::new();
    token
        .create_auxiliary_token_account(&alice_keypair, &alice.pubkey())
        .await
        .unwrap();
    let bob_keypair = Keypair::new();
    token
        .create_auxiliary_token_account(&bob_keypair, &bob.pubkey())
        .await
        .unwrap();
    token
        .mint_to(
            &alice_keypair.pubkey(),
            &mint_authority.pubkey(),
            SUPPLY,
            &[mint_authority],
        )
        .await
        .unwrap();

    Ok(Fixture {
        context,
        authority,
        stake_withdrawer,
        fee_destination,
        settler,
        settler_account,
        alice_account: alice_keypair.pubkey(),
        bob_account: bob_keypair.pubkey(),
    })
}

async fn setup() -> Fixture {
    setup_with(LOCKUP_EPOCH, LOCKUP_EPOCH).await.unwrap()
}

fn token(f: &Fixture) -> &Token<ProgramBanksClientProcessTransaction> {
    &f.context.token_context.as_ref().unwrap().token
}

async fn transfer(f: &Fixture, amount: u64) -> Result<(), TokenClientError> {
    let ctx = f.context.token_context.as_ref().unwrap();
    let ix = srf_instruction::transfer_checked_writable_mint(
        &id(),
        &f.alice_account,
        ctx.token.get_address(),
        &f.bob_account,
        &ctx.alice.pubkey(),
        &[],
        amount,
        ctx.decimals,
    )
    .unwrap();
    ctx.token
        .process_ixs(&[ix], &[&ctx.alice])
        .await
        .map(|_| ())
}

async fn withheld(f: &Fixture, account: &Pubkey) -> u64 {
    let state = token(f).get_account_info(account).await.unwrap();
    state
        .get_extension::<SlotReferenceFeeAmount>()
        .unwrap()
        .withheld_amount
        .into()
}

async fn balance(f: &Fixture, account: &Pubkey) -> u64 {
    token(f)
        .get_account_info(account)
        .await
        .unwrap()
        .base
        .amount
}

async fn config(f: &Fixture) -> SlotReferenceFeeConfig {
    *token(f)
        .get_mint_info()
        .await
        .unwrap()
        .get_extension::<SlotReferenceFeeConfig>()
        .unwrap()
}

async fn warp(f: &Fixture, slots: u64) {
    let mut ctx = f.context.context.lock().await;
    let current = ctx.banks_client.get_root_slot().await.unwrap();
    ctx.warp_to_slot(current + slots).unwrap();
}

fn ceil_bps(amount: u64, bps: u64) -> u64 {
    (amount * bps).div_ceil(10_000)
}

#[tokio::test]
async fn success_initialize() {
    let f = setup().await;
    let c = config(&f).await;
    assert_eq!(
        Option::<Pubkey>::from(c.authority),
        Some(f.authority.pubkey())
    );
    assert_eq!(c.fee_destination, f.fee_destination);
    assert_eq!(c.settler, f.settler.pubkey());
    assert_eq!(c.stake_withdrawer, f.stake_withdrawer.pubkey());
    assert_eq!(u64::from(c.stake_lockup_epoch), LOCKUP_EPOCH);
    assert_eq!(u16::from(c.floor_basis_points), FLOOR_BPS);
    assert_eq!(u16::from(c.cap_basis_points), CAP_BPS);
    assert_eq!(u16::from(c.free_references), FREE_REFS);
    assert_eq!(u16::from(c.slow_floor_basis_points), SLOW_FLOOR_BPS);
    assert_eq!(u16::from(c.slow_cap_basis_points), SLOW_CAP_BPS);
    assert_eq!(u16::from(c.slow_free_references), SLOW_FREE_REFS);
    assert_eq!(u64::from(c.slow_window_slots), SLOW_WINDOW);
    assert_eq!(u64::from(c.count), 0);
    assert_eq!(u64::from(c.withheld_amount), 0);
    assert_eq!(withheld(&f, &f.bob_account).await, 0);
}

#[tokio::test]
async fn fail_initialize_bad_schedule() {
    let context = TestContext::new().await;
    let withdrawer = Keypair::new();
    let fee_destination = plant_stake_account(&context, &withdrawer.pubkey(), LOCKUP_EPOCH).await;
    let mut context = context;
    let err = context
        .init_token_with_mint(vec![
            ExtensionInitializationParams::SlotReferenceFeeConfig {
                authority: None,
                fee_destination,
                settler: Pubkey::new_unique(),
                floor_basis_points: 20,
                cap_basis_points: 10,
                free_references: 0,
                slow_floor_basis_points: SLOW_FLOOR_BPS,
                slow_cap_basis_points: SLOW_CAP_BPS,
                slow_free_references: SLOW_FREE_REFS,
                slow_window_slots: SLOW_WINDOW,
                stake_withdrawer: withdrawer.pubkey(),
                stake_lockup_epoch: LOCKUP_EPOCH,
            },
        ])
        .await
        .unwrap_err();
    assert_eq!(
        err,
        custom_at(1, TokenError::SlotReferenceFeeExceedsMaximum)
    );
}

#[tokio::test]
async fn fail_initialize_destination_not_locked_long_enough() {
    // the account is locked to epoch 100, the initializer demands 900
    let err = setup_with(100, LOCKUP_EPOCH).await.err().unwrap();
    assert_eq!(
        err,
        custom_at(1, TokenError::SlotReferenceFeeDestinationNotStake)
    );
}

#[tokio::test]
async fn fail_initialize_destination_not_a_stake_account() {
    let mut context = TestContext::new().await;
    let withdrawer = Keypair::new();
    let err = context
        .init_token_with_mint(vec![
            ExtensionInitializationParams::SlotReferenceFeeConfig {
                authority: None,
                // a fresh system account is not a stake account
                fee_destination: Pubkey::new_unique(),
                settler: Pubkey::new_unique(),
                floor_basis_points: FLOOR_BPS,
                cap_basis_points: CAP_BPS,
                free_references: FREE_REFS,
                slow_floor_basis_points: SLOW_FLOOR_BPS,
                slow_cap_basis_points: SLOW_CAP_BPS,
                slow_free_references: SLOW_FREE_REFS,
                slow_window_slots: SLOW_WINDOW,
                stake_withdrawer: withdrawer.pubkey(),
                stake_lockup_epoch: 0,
            },
        ])
        .await
        .unwrap_err();
    assert_eq!(
        err,
        custom_at(1, TokenError::SlotReferenceFeeDestinationNotStake)
    );
}

#[tokio::test]
async fn escalates_within_a_slot_and_resets_on_the_next() {
    let f = setup().await;
    let a1 = 100_000_000;
    let a2 = 100_000_001;
    let a3 = 100_000_002;

    // first reference in the slot is free on both ratchets
    transfer(&f, a1).await.unwrap();
    assert_eq!(withheld(&f, &f.bob_account).await, 0);
    assert_eq!(balance(&f, &f.bob_account).await, a1);
    let c = config(&f).await;
    assert_eq!(u64::from(c.count), 1);

    // second: fast #2 is free, but it is alice's second in the window: slow 2 bp * 4 = 8 bp
    transfer(&f, a2).await.unwrap();
    let fee2 = ceil_bps(a2, 8);
    assert_eq!(withheld(&f, &f.bob_account).await, fee2);
    // third: fast 10 bp * 9 = 90 bp beats slow 18 bp
    transfer(&f, a3).await.unwrap();
    let fee3 = ceil_bps(a3, 90);
    assert_eq!(withheld(&f, &f.bob_account).await, fee2 + fee3);
    assert_eq!(
        balance(&f, &f.bob_account).await,
        a1 + a2 + a3 - fee2 - fee3
    );
    assert_eq!(balance(&f, &f.alice_account).await, SUPPLY - a1 - a2 - a3);
    let c = config(&f).await;
    assert_eq!(u64::from(c.count), 3);

    // a new slot starts the fast count over; alice is still in her window, so slow #4 = 32 bp
    warp(&f, 1).await;
    transfer(&f, a1).await.unwrap();
    let fee4 = ceil_bps(a1, 32);
    assert_eq!(withheld(&f, &f.bob_account).await, fee2 + fee3 + fee4);
    let c = config(&f).await;
    assert_eq!(u64::from(c.count), 1);

    // harvest to the mint, then the permissionless withdrawal to the settler
    let ix = srf_instruction::harvest_withheld_tokens_to_mint(
        &id(),
        token(&f).get_address(),
        &[&f.bob_account],
    )
    .unwrap();
    token(&f)
        .process_ixs::<[&dyn Signer; 0]>(&[ix], &[])
        .await
        .unwrap();
    assert_eq!(withheld(&f, &f.bob_account).await, 0);
    let total = fee2 + fee3 + fee4;
    let c = config(&f).await;
    assert_eq!(u64::from(c.withheld_amount), total);

    let ix = srf_instruction::withdraw_withheld_tokens_from_mint(
        &id(),
        token(&f).get_address(),
        &f.settler_account,
    )
    .unwrap();
    token(&f)
        .process_ixs::<[&dyn Signer; 0]>(&[ix], &[])
        .await
        .unwrap();
    assert_eq!(balance(&f, &f.settler_account).await, total);
    let c = config(&f).await;
    assert_eq!(u64::from(c.withheld_amount), 0);
}

#[tokio::test]
async fn slow_ratchet_follows_the_account_across_slots() {
    let f = setup().await;
    let a = 100_000_000;
    transfer(&f, a).await.unwrap();
    assert_eq!(withheld(&f, &f.bob_account).await, 0);
    // a later slot in the same window: fast #1 free, slow #2 = 8 bp
    warp(&f, 10).await;
    transfer(&f, a).await.unwrap();
    assert_eq!(withheld(&f, &f.bob_account).await, ceil_bps(a, 8));
    // the next window: alice starts over
    warp(&f, SLOW_WINDOW).await;
    let before = withheld(&f, &f.bob_account).await;
    transfer(&f, a).await.unwrap();
    assert_eq!(withheld(&f, &f.bob_account).await, before);
}

#[tokio::test]
async fn cap_binds_after_enough_references() {
    let f = setup().await;
    // 32nd reference at floor 10 bp is 10,240 bp, capped to 100%
    for i in 0..31u64 {
        transfer(&f, 1_000 + i).await.unwrap();
    }
    let before = withheld(&f, &f.bob_account).await;
    let bob_before = balance(&f, &f.bob_account).await;
    transfer(&f, 5_000).await.unwrap();
    assert_eq!(withheld(&f, &f.bob_account).await - before, 5_000);
    assert_eq!(balance(&f, &f.bob_account).await, bob_before);
}

#[tokio::test]
async fn fail_mint_not_writable() {
    let f = setup().await;
    let ctx = f.context.token_context.as_ref().unwrap();
    // the ordinary client transfer marks the mint read-only
    let err = ctx
        .token
        .transfer(
            &f.alice_account,
            &f.bob_account,
            &ctx.alice.pubkey(),
            1_000,
            &[&ctx.alice],
        )
        .await
        .unwrap_err();
    assert_eq!(err, custom(TokenError::SlotReferenceFeeMintNotWritable));
}

#[tokio::test]
async fn fail_withdraw_anywhere_but_the_settler() {
    let f = setup().await;
    let ctx = f.context.token_context.as_ref().unwrap();
    transfer(&f, 100_000_000).await.unwrap();
    transfer(&f, 100_000_001).await.unwrap();
    let harvest = srf_instruction::harvest_withheld_tokens_to_mint(
        &id(),
        ctx.token.get_address(),
        &[&f.bob_account],
    )
    .unwrap();
    ctx.token
        .process_ixs::<[&dyn Signer; 0]>(&[harvest], &[])
        .await
        .unwrap();

    // a token account owned by alice is not the settler's
    let ix = srf_instruction::withdraw_withheld_tokens_from_mint(
        &id(),
        ctx.token.get_address(),
        &f.alice_account,
    )
    .unwrap();
    let err = ctx
        .token
        .process_ixs::<[&dyn Signer; 0]>(&[ix], &[])
        .await
        .unwrap_err();
    assert_eq!(err, custom(TokenError::SlotReferenceFeeInvalidSink));
}

#[tokio::test]
async fn fail_close_with_withheld() {
    let f = setup().await;
    let ctx = f.context.token_context.as_ref().unwrap();
    transfer(&f, 100_000_000).await.unwrap();
    transfer(&f, 100_000_001).await.unwrap();
    // move bob's balance back so only the withheld fees remain
    let bob_balance = balance(&f, &f.bob_account).await;
    let ix = srf_instruction::transfer_checked_writable_mint(
        &id(),
        &f.bob_account,
        ctx.token.get_address(),
        &f.alice_account,
        &ctx.bob.pubkey(),
        &[],
        bob_balance,
        ctx.decimals,
    )
    .unwrap();
    ctx.token.process_ixs(&[ix], &[&ctx.bob]).await.unwrap();
    assert_eq!(balance(&f, &f.bob_account).await, 0);
    assert!(withheld(&f, &f.bob_account).await > 0);

    let err = ctx
        .token
        .close_account(
            &f.bob_account,
            &ctx.bob.pubkey(),
            &ctx.bob.pubkey(),
            &[&ctx.bob],
        )
        .await
        .unwrap_err();
    assert_eq!(err, custom(TokenError::AccountHasWithheldSlotReferenceFees));
}

#[tokio::test]
async fn set_schedule_and_authority() {
    let f = setup().await;
    let ctx = f.context.token_context.as_ref().unwrap();

    // the wrong signer cannot set
    let ix = srf_instruction::set(
        &id(),
        ctx.token.get_address(),
        &ctx.alice.pubkey(),
        &[],
        &f.fee_destination,
        20,
        5_000,
        3,
        SLOW_FLOOR_BPS,
        SLOW_CAP_BPS,
        SLOW_FREE_REFS,
        SLOW_WINDOW,
    )
    .unwrap();
    let err = ctx
        .token
        .process_ixs(&[ix], &[&ctx.alice])
        .await
        .unwrap_err();
    assert_eq!(err, custom(TokenError::OwnerMismatch));

    // the authority cannot move the destination to a stake account with a shorter lockup
    let short = plant_stake_account(&f.context, &f.stake_withdrawer.pubkey(), 1).await;
    let ix = srf_instruction::set(
        &id(),
        ctx.token.get_address(),
        &f.authority.pubkey(),
        &[],
        &short,
        20,
        5_000,
        3,
        SLOW_FLOOR_BPS,
        SLOW_CAP_BPS,
        SLOW_FREE_REFS,
        SLOW_WINDOW,
    )
    .unwrap();
    let err = ctx
        .token
        .process_ixs(&[ix], &[&f.authority])
        .await
        .unwrap_err();
    assert_eq!(err, custom(TokenError::SlotReferenceFeeDestinationNotStake));

    // the authority can, to a qualifying one
    let longer =
        plant_stake_account(&f.context, &f.stake_withdrawer.pubkey(), LOCKUP_EPOCH + 1).await;
    let ix = srf_instruction::set(
        &id(),
        ctx.token.get_address(),
        &f.authority.pubkey(),
        &[],
        &longer,
        20,
        5_000,
        3,
        SLOW_FLOOR_BPS,
        SLOW_CAP_BPS,
        SLOW_FREE_REFS,
        SLOW_WINDOW,
    )
    .unwrap();
    ctx.token.process_ixs(&[ix], &[&f.authority]).await.unwrap();
    let c = config(&f).await;
    assert_eq!(c.fee_destination, longer);
    assert_eq!(u16::from(c.floor_basis_points), 20);
    assert_eq!(u16::from(c.cap_basis_points), 5_000);
    assert_eq!(u16::from(c.free_references), 3);
    assert_eq!(c.settler, f.settler.pubkey());

    // three free references on the fast ratchet now; alice's slow count still runs: #2 = 8, #3 = 18 bp
    transfer(&f, 1_000_000).await.unwrap();
    transfer(&f, 1_000_001).await.unwrap();
    assert_eq!(withheld(&f, &f.bob_account).await, ceil_bps(1_000_001, 8));
    transfer(&f, 1_000_002).await.unwrap();
    assert_eq!(
        withheld(&f, &f.bob_account).await,
        ceil_bps(1_000_001, 8) + ceil_bps(1_000_002, 18)
    );
    // the fourth is fast #4 at 20 bp * 16 = 320 bp, which beats slow 32 bp
    transfer(&f, 1_000_003).await.unwrap();
    assert_eq!(
        withheld(&f, &f.bob_account).await,
        ceil_bps(1_000_001, 8) + ceil_bps(1_000_002, 18) + ceil_bps(1_000_003, 320)
    );

    // revoke the authority; the schedule is now immutable
    ctx.token
        .set_authority(
            ctx.token.get_address(),
            &f.authority.pubkey(),
            None,
            AuthorityType::SlotReferenceFee,
            &[&f.authority],
        )
        .await
        .unwrap();
    let c = config(&f).await;
    assert_eq!(Option::<Pubkey>::from(c.authority), None);
    let ix = srf_instruction::set(
        &id(),
        ctx.token.get_address(),
        &f.authority.pubkey(),
        &[],
        &longer,
        10,
        10_000,
        1,
        SLOW_FLOOR_BPS,
        SLOW_CAP_BPS,
        SLOW_FREE_REFS,
        SLOW_WINDOW,
    )
    .unwrap();
    let err = ctx
        .token
        .process_ixs(&[ix], &[&f.authority])
        .await
        .unwrap_err();
    assert_eq!(err, custom(TokenError::NoAuthorityExists));
}
