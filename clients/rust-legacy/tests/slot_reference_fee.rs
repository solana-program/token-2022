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
                self, instruction as srf_instruction, SlotReferenceFeeAmount,
                SlotReferenceFeeConfig,
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
const FREE_REFS: u16 = 1;
const SINK_SHARE_BPS: u16 = 5_000;
const SUPPLY: u64 = 1_000_000_000;

struct Fixture {
    context: TestContext,
    authority: Keypair,
    fee_owner: Keypair,
    fee_destination: Pubkey,
    sink: Pubkey,
    alice_account: Pubkey,
    bob_account: Pubkey,
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

async fn setup() -> Fixture {
    let mut context = TestContext::new().await;
    let mint = Keypair::new();
    let authority = Keypair::new();
    let fee_owner = Keypair::new();
    // the fee destination is a token account of the mint, so it can only exist
    // after the mint does; its associated address is known in advance
    let fee_destination =
        get_associated_token_address_with_program_id(&fee_owner.pubkey(), &mint.pubkey(), &id());
    context
        .init_token_with_mint_keypair_and_freeze_authority(
            mint,
            vec![ExtensionInitializationParams::SlotReferenceFeeConfig {
                authority: Some(authority.pubkey()),
                fee_destination,
                floor_basis_points: FLOOR_BPS,
                cap_basis_points: CAP_BPS,
                free_references: FREE_REFS,
                sink_share_basis_points: SINK_SHARE_BPS,
            }],
            None,
        )
        .await
        .unwrap();

    let TokenContext {
        token,
        alice,
        bob,
        mint_authority,
        ..
    } = context.token_context.as_ref().unwrap();

    token
        .create_associated_token_account(&fee_owner.pubkey())
        .await
        .unwrap();
    let sink_owner = slot_reference_fee::sink_owner();
    token
        .create_associated_token_account(&sink_owner)
        .await
        .unwrap();
    let sink = token.get_associated_token_address(&sink_owner);

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

    Fixture {
        context,
        authority,
        fee_owner,
        fee_destination,
        sink,
        alice_account: alice_keypair.pubkey(),
        bob_account: bob_keypair.pubkey(),
    }
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
    assert_eq!(u16::from(c.floor_basis_points), FLOOR_BPS);
    assert_eq!(u16::from(c.cap_basis_points), CAP_BPS);
    assert_eq!(u16::from(c.free_references), FREE_REFS);
    assert_eq!(u16::from(c.sink_share_basis_points), SINK_SHARE_BPS);
    assert_eq!(u64::from(c.count), 0);
    assert_eq!(u64::from(c.withheld_amount), 0);
    assert_eq!(withheld(&f, &f.bob_account).await, 0);
}

#[tokio::test]
async fn fail_initialize_bad_schedule() {
    let mut context = TestContext::new().await;
    let err = context
        .init_token_with_mint(vec![
            ExtensionInitializationParams::SlotReferenceFeeConfig {
                authority: None,
                fee_destination: Pubkey::new_unique(),
                floor_basis_points: 20,
                cap_basis_points: 10,
                free_references: 0,
                sink_share_basis_points: SINK_SHARE_BPS,
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
async fn escalates_within_a_slot_and_resets_on_the_next() {
    let f = setup().await;
    let a1 = 100_000_000;
    let a2 = 100_000_001;
    let a3 = 100_000_002;

    // first reference in the slot is free
    transfer(&f, a1).await.unwrap();
    assert_eq!(withheld(&f, &f.bob_account).await, 0);
    assert_eq!(balance(&f, &f.bob_account).await, a1);
    let c = config(&f).await;
    assert_eq!(u64::from(c.count), 1);

    // second pays 10 bp * 4 = 40 bp, third 90 bp, both of the transferred amount
    transfer(&f, a2).await.unwrap();
    let fee2 = ceil_bps(a2, 40);
    assert_eq!(withheld(&f, &f.bob_account).await, fee2);
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

    // a new slot starts the count over: free again
    warp(&f, 1).await;
    transfer(&f, a1).await.unwrap();
    assert_eq!(withheld(&f, &f.bob_account).await, fee2 + fee3);
    let c = config(&f).await;
    assert_eq!(u64::from(c.count), 1);

    // harvest to the mint, then the permissionless split
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
    assert_eq!(u64::from(c.withheld_amount), fee2 + fee3);

    let ix = srf_instruction::withdraw_withheld_tokens_from_mint(
        &id(),
        token(&f).get_address(),
        &f.sink,
        &f.fee_destination,
    )
    .unwrap();
    token(&f)
        .process_ixs::<[&dyn Signer; 0]>(&[ix], &[])
        .await
        .unwrap();
    let total = fee2 + fee3;
    let sink_share = total * u64::from(SINK_SHARE_BPS) / 10_000;
    assert_eq!(balance(&f, &f.sink).await, sink_share);
    assert_eq!(balance(&f, &f.fee_destination).await, total - sink_share);
    let c = config(&f).await;
    assert_eq!(u64::from(c.withheld_amount), 0);
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
async fn fail_withdraw_to_wrong_sink_or_destination() {
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

    // a sink owned by alice is not a sink
    let ix = srf_instruction::withdraw_withheld_tokens_from_mint(
        &id(),
        ctx.token.get_address(),
        &f.alice_account,
        &f.fee_destination,
    )
    .unwrap();
    let err = ctx
        .token
        .process_ixs::<[&dyn Signer; 0]>(&[ix], &[])
        .await
        .unwrap_err();
    assert_eq!(err, custom(TokenError::SlotReferenceFeeInvalidSink));

    // a destination other than the configured one is refused
    let ix = srf_instruction::withdraw_withheld_tokens_from_mint(
        &id(),
        ctx.token.get_address(),
        &f.sink,
        &f.bob_account,
    )
    .unwrap();
    let err = ctx
        .token
        .process_ixs::<[&dyn Signer; 0]>(&[ix], &[])
        .await
        .unwrap_err();
    assert_eq!(err, custom(TokenError::SlotReferenceFeeDestinationMismatch));
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
        2,
    )
    .unwrap();
    let err = ctx
        .token
        .process_ixs(&[ix], &[&ctx.alice])
        .await
        .unwrap_err();
    assert_eq!(err, custom(TokenError::OwnerMismatch));

    // the authority can
    let ix = srf_instruction::set(
        &id(),
        ctx.token.get_address(),
        &f.authority.pubkey(),
        &[],
        &f.fee_destination,
        20,
        5_000,
        2,
    )
    .unwrap();
    ctx.token.process_ixs(&[ix], &[&f.authority]).await.unwrap();
    let c = config(&f).await;
    assert_eq!(u16::from(c.floor_basis_points), 20);
    assert_eq!(u16::from(c.cap_basis_points), 5_000);
    assert_eq!(u16::from(c.free_references), 2);
    assert_eq!(u16::from(c.sink_share_basis_points), SINK_SHARE_BPS);

    // two free references now, third pays 20 bp * 9 = 180 bp
    transfer(&f, 1_000_000).await.unwrap();
    transfer(&f, 1_000_001).await.unwrap();
    assert_eq!(withheld(&f, &f.bob_account).await, 0);
    transfer(&f, 1_000_002).await.unwrap();
    assert_eq!(withheld(&f, &f.bob_account).await, ceil_bps(1_000_002, 180));

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
        &f.fee_destination,
        10,
        10_000,
        1,
    )
    .unwrap();
    let err = ctx
        .token
        .process_ixs(&[ix], &[&f.authority])
        .await
        .unwrap_err();
    assert_eq!(err, custom(TokenError::NoAuthorityExists));
    let _ = &f.fee_owner;
}
