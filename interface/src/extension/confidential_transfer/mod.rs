use {
    crate::{
        error::TokenError,
        extension::{Extension, ExtensionType},
    },
    bytemuck::{Pod, Zeroable},
    solana_address::Address,
    solana_nullable::MaybeNull,
    solana_program_error::ProgramResult,
    solana_zero_copy::unaligned::{Bool, U64},
    solana_zk_sdk_pod::encryption::{
        auth_encryption::PodAeCiphertext,
        elgamal::{PodElGamalCiphertext, PodElGamalPubkey},
    },
};

/// Maximum bit length of any deposit or transfer amount
///
/// Any deposit or transfer amount must be less than `2^48`
pub const MAXIMUM_DEPOSIT_TRANSFER_AMOUNT: u64 = (u16::MAX as u64) + (1 << 16) * (u32::MAX as u64);

/// Bit length of the low bits of pending balance plaintext
pub const PENDING_BALANCE_LO_BIT_LENGTH: u32 = 16;

/// The default maximum pending balance credit counter.
pub const DEFAULT_MAXIMUM_PENDING_BALANCE_CREDIT_COUNTER: u64 = 65536;

/// Confidential Transfer Extension instructions
pub mod instruction;

/// ElGamal ciphertext containing an account balance
pub type EncryptedBalance = PodElGamalCiphertext;
/// Authenticated encryption containing an account balance
pub type DecryptableBalance = PodAeCiphertext;

/// Confidential transfer mint configuration
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct ConfidentialTransferMint {
    /// Authority to modify the `ConfidentialTransferMint` configuration and to
    /// approve new accounts (if `auto_approve_new_accounts` is true)
    ///
    /// The legacy Token Multisig account is not supported as the authority
    pub authority: MaybeNull<Address>,

    /// Indicate if newly configured accounts must be approved by the
    /// `authority` before they may be used by the user.
    ///
    /// * If `true`, no approval is required and new accounts may be used
    ///   immediately
    /// * If `false`, the authority must approve newly configured accounts (see
    ///   `ConfidentialTransferInstruction::ConfigureAccount`)
    pub auto_approve_new_accounts: Bool,

    /// Authority to decode any transfer amount in a confidential transfer.
    pub auditor_elgamal_pubkey: MaybeNull<PodElGamalPubkey>,
}

impl Extension for ConfidentialTransferMint {
    const TYPE: ExtensionType = ExtensionType::ConfidentialTransferMint;
}

/// Confidential account state.
///
/// # Pending balance credit counters
///
/// Incoming credits accumulate in `pending_balance_lo` and `pending_balance_hi`,
/// and `pending_balance_credit_counter` counts the credits since the last
/// `ApplyPendingBalance`.
///
/// To prepare `ApplyPendingBalance`, the client computes a new AES-encrypted
/// available balance from the account data fetched by the client and supplies
/// the pending credit count from that data as
/// `expected_pending_balance_credit_counter`. More credits may arrive before
/// the instruction executes.
///
/// At execution, the program records the client's expected count and the current
/// `pending_balance_credit_counter` as `actual_pending_balance_credit_counter`.
/// It applies the entire pending balance to `available_balance` and resets the
/// pending balance and its counter to zero, even if the expected and actual
/// counts differ. The supplied AES-encrypted balance is stored unchanged in
/// `decryptable_available_balance`.
///
/// The expected and actual counts persist until the next `ApplyPendingBalance`;
/// later credits only increment `pending_balance_credit_counter`. Clients can
/// compare the recorded counts after the instruction succeeds to detect credits
/// that arrived after they fetched the account data. For example, if the client
/// observed two credits and a third arrived before execution, all three are
/// applied, but the recorded expected and actual counts are two and three.
///
/// In that case, `decryptable_available_balance` may be missing the third credit,
/// so the client must recover the correct available balance before relying on
/// that cache. Applying the pending balance again using the stale cache does not
/// recover credits that were already applied.
///
/// These counters help detect changes to the pending balance; matching counts
/// do not verify the supplied decryptable balance, which the program does not
/// check against the ElGamal-encrypted `available_balance`.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Pod, Zeroable)]
pub struct ConfidentialTransferAccount {
    /// `true` if this account has been approved for use. All confidential
    /// transfer operations for the account will fail until approval is
    /// granted.
    pub approved: Bool,

    /// The public key associated with ElGamal encryption
    pub elgamal_pubkey: PodElGamalPubkey,

    /// The low 16 bits of the pending balance (encrypted by `elgamal_pubkey`)
    pub pending_balance_lo: EncryptedBalance,

    /// The high 32 bits of the pending balance (encrypted by `elgamal_pubkey`)
    pub pending_balance_hi: EncryptedBalance,

    /// The available balance (encrypted by `encryption_pubkey`)
    pub available_balance: EncryptedBalance,

    /// The decryptable available balance
    pub decryptable_available_balance: DecryptableBalance,

    /// If `false`, the extended account rejects any incoming confidential
    /// transfers
    pub allow_confidential_credits: Bool,

    /// If `false`, the base account rejects any incoming transfers
    pub allow_non_confidential_credits: Bool,

    /// The number of credits to the pending balance since the last
    /// `ApplyPendingBalance` instruction.
    ///
    /// Reset to zero when the pending balance is applied.
    pub pending_balance_credit_counter: U64,

    /// The maximum number of `Deposit` and `Transfer` instructions that can
    /// credit `pending_balance` before the `ApplyPendingBalance`
    /// instruction is executed
    pub maximum_pending_balance_credit_counter: U64,

    /// The pending credit count supplied by the client in the last
    /// `ApplyPendingBalance` instruction.
    ///
    /// Clients copy `pending_balance_credit_counter` from the same fetched
    /// account data used to compute the new decryptable available balance.
    /// The program records this expectation without requiring it to match
    /// `actual_pending_balance_credit_counter`.
    pub expected_pending_balance_credit_counter: U64,

    /// The pending credit count observed by the program during the last
    /// `ApplyPendingBalance`, before resetting the pending balance and its
    /// counter.
    ///
    /// Comparing this with `expected_pending_balance_credit_counter`
    /// helps clients detect credits that arrived after they fetched the account
    /// data and may be missing from `decryptable_available_balance`.
    pub actual_pending_balance_credit_counter: U64,
}

impl Extension for ConfidentialTransferAccount {
    const TYPE: ExtensionType = ExtensionType::ConfidentialTransferAccount;
}

impl ConfidentialTransferAccount {
    /// Check if a `ConfidentialTransferAccount` has been approved for use.
    pub fn approved(&self) -> ProgramResult {
        if bool::from(&self.approved) {
            Ok(())
        } else {
            Err(TokenError::ConfidentialTransferAccountNotApproved.into())
        }
    }

    /// Check if a `ConfidentialTransferAccount` is in a closable state.
    pub fn closable(&self) -> ProgramResult {
        if self.pending_balance_lo == EncryptedBalance::zeroed()
            && self.pending_balance_hi == EncryptedBalance::zeroed()
            && self.available_balance == EncryptedBalance::zeroed()
        {
            Ok(())
        } else {
            Err(TokenError::ConfidentialTransferAccountHasBalance.into())
        }
    }

    /// Check if a base account of a `ConfidentialTransferAccount` accepts
    /// non-confidential transfers.
    pub fn non_confidential_transfer_allowed(&self) -> ProgramResult {
        if bool::from(&self.allow_non_confidential_credits) {
            Ok(())
        } else {
            Err(TokenError::NonConfidentialTransfersDisabled.into())
        }
    }

    /// Checks if a `ConfidentialTransferAccount` is configured to send funds.
    pub fn valid_as_source(&self) -> ProgramResult {
        self.approved()
    }

    /// Checks if a confidential extension is configured to receive funds.
    ///
    /// A destination account can receive funds if the following conditions are
    /// satisfied:
    ///   1. The account is approved by the confidential transfer mint authority
    ///   2. The account is not disabled by the account owner
    ///   3. The number of credits into the account has not reached the maximum
    ///      credit counter
    pub fn valid_as_destination(&self) -> ProgramResult {
        self.approved()?;

        if !bool::from(self.allow_confidential_credits) {
            return Err(TokenError::ConfidentialTransferDepositsAndTransfersDisabled.into());
        }

        let new_destination_pending_balance_credit_counter =
            u64::from(self.pending_balance_credit_counter)
                .checked_add(1)
                .ok_or(TokenError::Overflow)?;
        if new_destination_pending_balance_credit_counter
            > u64::from(self.maximum_pending_balance_credit_counter)
        {
            return Err(TokenError::MaximumPendingBalanceCreditCounterExceeded.into());
        }

        Ok(())
    }

    /// Checks if a confidential extension is configured to receive withheld tokens.
    ///
    /// Since withheld tokens are credited directly to the available balance,
    /// we do not need to check the pending balance credit counter.
    pub fn valid_as_withheld_amount_destination(&self) -> ProgramResult {
        self.approved()?;

        if !bool::from(self.allow_confidential_credits) {
            return Err(TokenError::ConfidentialTransferDepositsAndTransfersDisabled.into());
        }

        Ok(())
    }

    /// Increments a confidential extension pending balance credit counter.
    pub fn increment_pending_balance_credit_counter(&mut self) -> ProgramResult {
        self.pending_balance_credit_counter = (u64::from(self.pending_balance_credit_counter)
            .checked_add(1)
            .ok_or(TokenError::Overflow)?)
        .into();
        Ok(())
    }
}
