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
const SLOW_CAP_BPS: u16 = 10_000;
const SLOW_FREE_REFS: u16 = 16;
const SLOW_WINDOW: u64 = 20_000; // a week of 400 ms slots is 1_512_000; shorter here so the test can warp past it
const LOCKUP_EPOCH: u64 = 900;
const MIN_REF: u64 = 1_000;
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
fn stake_account_data(withdrawer: &Pubkey, lockup_epoch: u64, custodian: &Pubkey) -> Vec<u8> {
    let mut data = vec![0u8; 200];
    data[0..4].copy_from_slice(&1u32.to_le_bytes());
    data[12..44].copy_from_slice(withdrawer.as_ref()); // staker
    data[44..76].copy_from_slice(withdrawer.as_ref()); // withdrawer
    data[84..92].copy_from_slice(&lockup_epoch.to_le_bytes());
    data[92..124].copy_from_slice(custodian.as_ref());
    data
}

/// Put a stake-program-owned account with no lockup custodian on the ledger.
async fn plant_stake_account(
    context: &TestContext,
    withdrawer: &Pubkey,
    lockup_epoch: u64,
) -> Pubkey {
    plant_stake_account_with_custodian(context, withdrawer, lockup_epoch, &Pubkey::default()).await
}

/// Put a stake-program-owned account on the ledger.
async fn plant_stake_account_with_custodian(
    context: &TestContext,
    withdrawer: &Pubkey,
    lockup_epoch: u64,
    custodian: &Pubkey,
) -> Pubkey {
    let key = Pubkey::new_unique();
    let mut ctx = context.context.lock().await;
    ctx.set_account(
        &key,
        &solana_sdk::account::Account {
            lamports: 10_000_000_000,
            data: stake_account_data(withdrawer, lockup_epoch, custodian),
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
                min_reference_amount: MIN_REF,
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

/// Another token account of the mint, owned by alice.
async fn new_account(f: &Fixture) -> Pubkey {
    let ctx = f.context.token_context.as_ref().unwrap();
    let keypair = Keypair::new();
    ctx.token
        .create_auxiliary_token_account(&keypair, &ctx.alice.pubkey())
        .await
        .unwrap();
    keypair.pubkey()
}

/// Transfer between two token accounts owned by alice.
async fn send(f: &Fixture, from: &Pubkey, to: &Pubkey, amount: u64) {
    let ctx = f.context.token_context.as_ref().unwrap();
    let ix = srf_instruction::transfer_checked_writable_mint(
        &id(),
        from,
        ctx.token.get_address(),
        to,
        &ctx.alice.pubkey(),
        &[],
        amount,
        ctx.decimals,
    )
    .unwrap();
    ctx.token.process_ixs(&[ix], &[&ctx.alice]).await.unwrap();
}

async fn counters(f: &Fixture, account: &Pubkey) -> SlotReferenceFeeAmount {
    *token(f)
        .get_account_info(account)
        .await
        .unwrap()
        .get_extension::<SlotReferenceFeeAmount>()
        .unwrap()
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
    assert_eq!(u64::from(c.min_reference_amount), MIN_REF);
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
                min_reference_amount: MIN_REF,
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
                min_reference_amount: MIN_REF,
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

    // a swap is two transfers: alice's first two references in the slot are free
    transfer(&f, a1).await.unwrap();
    transfer(&f, a2).await.unwrap();
    assert_eq!(withheld(&f, &f.bob_account).await, 0);
    let c = config(&f).await;
    assert_eq!(u64::from(c.count), 2);

    // her third in the slot (a second swap): fast 10 bp * 9 = 90 bp
    transfer(&f, a3).await.unwrap();
    let fee3 = ceil_bps(a3, 90);
    assert_eq!(withheld(&f, &f.bob_account).await, fee3);
    assert_eq!(balance(&f, &f.bob_account).await, a1 + a2 + a3 - fee3);
    assert_eq!(balance(&f, &f.alice_account).await, SUPPLY - a1 - a2 - a3);
    let c = config(&f).await;
    assert_eq!(u64::from(c.count), 3);

    // a new slot starts the fast count over: free again, and four in the window is under sixteen
    warp(&f, 1).await;
    transfer(&f, a1).await.unwrap();
    assert_eq!(withheld(&f, &f.bob_account).await, fee3);
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
    let c = config(&f).await;
    assert_eq!(u64::from(c.withheld_amount), fee3);

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
    assert_eq!(balance(&f, &f.settler_account).await, fee3);
    let c = config(&f).await;
    assert_eq!(u64::from(c.withheld_amount), 0);
}

#[tokio::test]
async fn bystander_in_a_busy_slot_pays_nothing() {
    let f = setup().await;
    // carol and dave hold accounts of their own; carol is funded in an earlier slot
    let carol = new_account(&f).await;
    let dave = new_account(&f).await;
    send(&f, &f.alice_account, &carol, 50_000_000).await;
    warp(&f, 1).await;
    // alice walks the mint four times in one slot: her 3rd and 4th pay
    for i in 0..4u64 {
        transfer(&f, 100_000_000 + i).await.unwrap();
    }
    let paid = withheld(&f, &f.bob_account).await;
    assert_eq!(paid, ceil_bps(100_000_002, 90) + ceil_bps(100_000_003, 160));
    // carol, in the same slot, sends once: global #5, her own #1: free
    send(&f, &carol, &dave, 1_000_000).await;
    assert_eq!(withheld(&f, &dave).await, 0, "the bystander paid nothing");
    let c = config(&f).await;
    assert_eq!(u64::from(c.count), 5);
}

#[tokio::test]
async fn buyers_from_a_busy_vault_pay_on_their_own_count() {
    let f = setup().await;
    // alice's account stands in for a pool vault: every buy is a transfer out of it
    let mut buyers = vec![];
    for _ in 0..20 {
        buyers.push(new_account(&f).await);
    }
    // three buyers in one slot: the vault is on its third reference, each buyer on their
    // first, so nobody pays the fast fee
    warp(&f, 1).await;
    for (i, buyer) in buyers.iter().take(3).enumerate() {
        send(&f, &f.alice_account, buyer, 10_000_000 + i as u64).await;
        assert_eq!(withheld(&f, buyer).await, 0);
    }
    // seventeen more over the window: the vault goes past sixteen, no buyer does
    for (i, buyer) in buyers.iter().skip(3).enumerate() {
        warp(&f, 3).await;
        send(&f, &f.alice_account, buyer, 10_000_000 + i as u64).await;
        assert_eq!(
            withheld(&f, buyer).await,
            0,
            "a buyer paid the vault's count"
        );
    }
    assert_eq!(u64::from(counters(&f, &f.alice_account).await.count), 20);
    assert_eq!(u64::from(counters(&f, &buyers[19]).await.count), 1);
    // one account that keeps coming back to the vault is priced on its own count
    let a = 1_000_000;
    for i in 0..15u64 {
        warp(&f, 3).await;
        send(&f, &f.alice_account, &buyers[0], a + i).await;
    }
    assert_eq!(withheld(&f, &buyers[0]).await, 0);
    warp(&f, 3).await;
    send(&f, &f.alice_account, &buyers[0], a).await;
    assert_eq!(withheld(&f, &buyers[0]).await, ceil_bps(a, 578));
}

#[tokio::test]
async fn dust_cannot_raise_the_receiver_count() {
    let f = setup().await;
    let carol = new_account(&f).await;
    // twenty dust transfers into bob: none of them counts on bob's account
    for i in 1..=20u64 {
        warp(&f, 3).await;
        transfer(&f, MIN_REF - i).await.unwrap();
    }
    let bob = counters(&f, &f.bob_account).await;
    assert_eq!(u64::from(bob.count), 0);
    assert_eq!(u64::from(bob.slot_count), 0);
    // bob's own first real transfer is his first reference, and free
    let ctx = f.context.token_context.as_ref().unwrap();
    let ix = srf_instruction::transfer_checked_writable_mint(
        &id(),
        &f.bob_account,
        ctx.token.get_address(),
        &carol,
        &ctx.bob.pubkey(),
        &[],
        5_000,
        ctx.decimals,
    )
    .unwrap();
    ctx.token.process_ixs(&[ix], &[&ctx.bob]).await.unwrap();
    assert_eq!(withheld(&f, &carol).await, 0);
    assert_eq!(u64::from(counters(&f, &f.bob_account).await.count), 1);
}

#[tokio::test]
async fn fail_initialize_destination_with_a_lockup_custodian() {
    // a custodian can lift the lockup, so a destination that has one is refused
    let mut context = TestContext::new().await;
    let withdrawer = Keypair::new();
    let fee_destination = plant_stake_account_with_custodian(
        &context,
        &withdrawer.pubkey(),
        LOCKUP_EPOCH,
        &Pubkey::new_unique(),
    )
    .await;
    let err = context
        .init_token_with_mint(vec![
            ExtensionInitializationParams::SlotReferenceFeeConfig {
                authority: None,
                fee_destination,
                settler: Pubkey::new_unique(),
                floor_basis_points: FLOOR_BPS,
                cap_basis_points: CAP_BPS,
                free_references: FREE_REFS,
                slow_floor_basis_points: SLOW_FLOOR_BPS,
                slow_cap_basis_points: SLOW_CAP_BPS,
                slow_free_references: SLOW_FREE_REFS,
                slow_window_slots: SLOW_WINDOW,
                stake_withdrawer: withdrawer.pubkey(),
                stake_lockup_epoch: LOCKUP_EPOCH,
                min_reference_amount: MIN_REF,
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
async fn slow_ratchet_follows_the_account_across_slots() {
    let f = setup().await;
    let a = 10_000_000; // eighteen of these fit in the supply
                        // sixteen touches over the week, each in its own slot, are free
    for i in 0..16u64 {
        transfer(&f, a + i).await.unwrap();
        warp(&f, 3).await;
    }
    assert_eq!(withheld(&f, &f.bob_account).await, 0);
    // the seventeenth pays 2 bp * 17² = 578 bp
    transfer(&f, a).await.unwrap();
    assert_eq!(withheld(&f, &f.bob_account).await, ceil_bps(a, 578));
    // the next window: alice starts over
    warp(&f, SLOW_WINDOW).await;
    let before = withheld(&f, &f.bob_account).await;
    transfer(&f, a).await.unwrap();
    assert_eq!(withheld(&f, &f.bob_account).await, before);
}

#[tokio::test]
async fn dust_cannot_raise_the_slot_count() {
    let f = setup().await;
    // distinct amounts so the five are five transactions, not one deduplicated one
    for i in 1..=5u64 {
        transfer(&f, MIN_REF - i).await.unwrap();
    }
    let c = config(&f).await;
    assert_eq!(u64::from(c.count), 0, "dust never moved the mint's counter");
    // a real transfer afterwards: global #1, alice's own #1 in the slot, 6th in her window: free
    transfer(&f, 100_000_000).await.unwrap();
    assert_eq!(withheld(&f, &f.bob_account).await, 0);
    let c = config(&f).await;
    assert_eq!(u64::from(c.count), 1);
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
    assert_eq!(err, custom(TokenError::SlotReferenceFeeInvalidSettler));
}

#[tokio::test]
async fn fail_close_with_withheld() {
    let f = setup().await;
    let ctx = f.context.token_context.as_ref().unwrap();
    transfer(&f, 100_000_000).await.unwrap();
    transfer(&f, 100_000_001).await.unwrap();
    transfer(&f, 100_000_002).await.unwrap(); // alice's third in the slot pays
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
async fn set_destination_and_authority() {
    let f = setup().await;
    let ctx = f.context.token_context.as_ref().unwrap();
    let mint = ctx.token.get_address();

    // the wrong signer cannot set
    let ix =
        srf_instruction::set(&id(), mint, &ctx.alice.pubkey(), &[], &f.fee_destination).unwrap();
    let err = ctx
        .token
        .process_ixs(&[ix], &[&ctx.alice])
        .await
        .unwrap_err();
    assert_eq!(err, custom(TokenError::OwnerMismatch));

    // the authority cannot move the destination to a stake account with a shorter lockup
    let short = plant_stake_account(&f.context, &f.stake_withdrawer.pubkey(), 1).await;
    let ix = srf_instruction::set(&id(), mint, &f.authority.pubkey(), &[], &short).unwrap();
    let err = ctx
        .token
        .process_ixs(&[ix], &[&f.authority])
        .await
        .unwrap_err();
    assert_eq!(err, custom(TokenError::SlotReferenceFeeDestinationNotStake));

    // the authority can, to a qualifying one, and the schedule does not move
    let longer =
        plant_stake_account(&f.context, &f.stake_withdrawer.pubkey(), LOCKUP_EPOCH + 1).await;
    let ix = srf_instruction::set(&id(), mint, &f.authority.pubkey(), &[], &longer).unwrap();
    ctx.token.process_ixs(&[ix], &[&f.authority]).await.unwrap();
    let c = config(&f).await;
    assert_eq!(c.fee_destination, longer);
    assert_eq!(u16::from(c.floor_basis_points), FLOOR_BPS);
    assert_eq!(u16::from(c.cap_basis_points), CAP_BPS);
    assert_eq!(u16::from(c.free_references), FREE_REFS);
    assert_eq!(c.settler, f.settler.pubkey());

    // revoke the authority; the destination is now fixed too
    ctx.token
        .set_authority(
            mint,
            &f.authority.pubkey(),
            None,
            AuthorityType::SlotReferenceFee,
            &[&f.authority],
        )
        .await
        .unwrap();
    let c = config(&f).await;
    assert_eq!(Option::<Pubkey>::from(c.authority), None);
    let ix = srf_instruction::set(&id(), mint, &f.authority.pubkey(), &[], &longer).unwrap();
    let err = ctx
        .token
        .process_ixs(&[ix], &[&f.authority])
        .await
        .unwrap_err();
    assert_eq!(err, custom(TokenError::NoAuthorityExists));
}
