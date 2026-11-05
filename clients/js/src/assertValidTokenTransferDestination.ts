import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import {
    fetchEncodedAccount,
    isOffCurveAddress,
    type Address,
    type FetchAccountConfig,
    type GetAccountInfoApi,
    type HasAddress,
    type ReadonlyUint8Array,
    type Rpc,
} from '@solana/kit';
import {
    getAddressFromResolvedInstructionAccount,
    type InstructionAccountInput,
} from '@solana/kit/program-client-core';

import {
    AccountState,
    decodeToken,
    findAssociatedTokenPda,
    getMultisigSize,
    TOKEN_2022_PROGRAM_ADDRESS,
} from './generated';
import { getTokenSize } from './getTokenSize';
import { TOKEN_PROGRAM_ADDRESS } from './legacyToken';

/** The Token-2022 `AccountType` byte, stored right after the base layout, that marks a token account. */
const TOKEN_2022_ACCOUNT_TYPE = 2;

/** Why a destination was rejected by {@link assertValidTokenTransferDestination}, with the fields specific to that reason. */
export type InvalidTokenTransferDestinationDetails =
    | {
          reason: 'unexpected-owner';
          /** The program that owns the recipient account. */
          owner: Address;
      }
    | { reason: 'unfunded-recipient' }
    | { reason: 'off-curve' }
    | { reason: 'ata-mismatch' }
    | { reason: 'missing-token-account' }
    | { reason: 'not-token-account' }
    | {
          reason: 'mint-mismatch';
          /** The mint the destination token account holds. */
          mint: Address;
      }
    | {
          reason: 'token-owner-mismatch';
          /** The current owner of the destination token account. */
          tokenOwner: Address;
      }
    | { reason: 'frozen' };

/** Distinguishes why a destination was rejected by {@link assertValidTokenTransferDestination}. */
export type InvalidTokenTransferDestinationReason = InvalidTokenTransferDestinationDetails['reason'];

/** Thrown by {@link assertValidTokenTransferDestination} when a destination is rejected. */
export class InvalidTokenTransferDestinationError extends Error {
    override readonly name = 'InvalidTokenTransferDestinationError';

    constructor(
        message: string,
        readonly destination: Address,
        readonly recipient: Address,
        readonly details: InvalidTokenTransferDestinationDetails,
    ) {
        super(message);
    }
}

export type AssertValidTokenTransferDestinationInput = {
    /** The token mint to transfer. */
    mint: InstructionAccountInput;
    /**
     * Associated token account address to transfer to, which may not exist yet. With
     * `allowNonAssociatedTokenAccount`, any existing token account owned by `recipient`.
     * Note: Use {@link findAssociatedTokenPda} to derive the associated token account address.
     */
    destination: InstructionAccountInput;
    /** Wallet address for the destination. */
    recipient: InstructionAccountInput;
};

/**
 * Options for {@link assertValidTokenTransferDestination}. Any {@link FetchAccountConfig} fields are passed
 * through to the account fetches.
 */
export type AssertValidTokenTransferDestinationConfig = FetchAccountConfig & {
    /**
     * Allow a recipient that has no account on-chain yet. Defaults to `false`, since an unfunded recipient
     * is often a mistyped address.
     */
    allowUnfundedRecipient?: boolean;
    /**
     * Allow an off-curve (program-derived) recipient, existing or not. Defaults to `true`, since
     * program-controlled wallets such as multisigs are common, legitimate recipients; set to `false` to
     * reject off-curve recipients.
     */
    allowOffCurve?: boolean;
    /**
     * The program an existing recipient account must be owned by. Defaults to the System Program
     * ({@link SYSTEM_PROGRAM_ADDRESS}).
     */
    programOwner?: Address;
    /**
     * Allow a destination that is not the recipient's associated token account, as long as it is an
     * existing token account for `mint` owned by `recipient`. Defaults to `false`. Such a destination cannot
     * be used with `getTransferToATAInstructionPlan`; transfer to it with `getTransferCheckedInstruction`.
     */
    allowNonAssociatedTokenAccount?: boolean;
    /**
     * Allow an associated token account destination that does not exist yet, creating it as part of the
     * transfer. Defaults to `true`, since a recipient's first transfer of a mint is the common case; set to
     * `false` to avoid paying its rent or to require that the recipient has held the mint before.
     */
    allowMissingAssociatedTokenAccount?: boolean;
    /**
     * The token program that owns `mint` and `destination`. Defaults to the Token-2022 program
     * ({@link TOKEN_2022_PROGRAM_ADDRESS}); pass {@link TOKEN_PROGRAM_ADDRESS} for legacy Token mints.
     */
    tokenProgram?: Address | HasAddress;
    /** The program that derives associated token accounts. Defaults to the Associated Token program. */
    associatedTokenProgram?: Address | HasAddress;
};

/**
 * Whether `data` has the layout of a token account for `tokenProgram`: exactly the base token account size,
 * or, outside the Token program, longer and marked as an account (Token-2022 extensions) rather than a mint or
 * multisig.
 */
function isTokenAccountData(data: ReadonlyUint8Array, tokenProgram: Address): boolean {
    const tokenSize = getTokenSize();
    if (data.length === tokenSize) return true;
    if (tokenProgram === TOKEN_PROGRAM_ADDRESS) return false;
    return data.length > tokenSize && data.length !== getMultisigSize() && data[tokenSize] === TOKEN_2022_ACCOUNT_TYPE;
}

/**
 * Asserts that `recipient` can safely receive a transfer of `mint` at `destination` by fetching both
 * accounts. By default, `destination` must be the recipient's associated token account for `mint`, matching
 * the inputs of `getTransferToATAInstructionPlan`. Otherwise throws an
 * {@link InvalidTokenTransferDestinationError} with one of these reasons:
 *
 * - `'unexpected-owner'`: the recipient account exists but is not owned by `programOwner` (the System
 *   Program by default), e.g. a token account or mint passed as the recipient.
 * - `'unfunded-recipient'`: the recipient has no account on-chain, which often means a mistyped address.
 *   Skipped when `allowUnfundedRecipient` is set.
 * - `'off-curve'`: the recipient is off-curve (program-derived), existing or not. Only checked when
 *   `allowOffCurve` is `false`.
 * - `'ata-mismatch'`: `destination` is not the recipient's associated token account for `mint`. Skipped
 *   when `allowNonAssociatedTokenAccount` is set.
 * - `'missing-token-account'`: `destination` has no account on-chain. Skipped for an associated token
 *   account unless `allowMissingAssociatedTokenAccount` is `false`.
 * - `'not-token-account'`: a non-associated `destination` is not an initialized token account.
 * - `'mint-mismatch'`: a non-associated `destination` holds a different mint.
 * - `'token-owner-mismatch'`: the destination exists but is not owned by `recipient`, e.g. an associated
 *   token account whose owner was reassigned.
 * - `'frozen'`: the destination is frozen by the mint's freeze authority, so the transfer would fail.
 *
 * Checks run in the order listed, so a destination that fails several reports the first.
 */
export async function assertValidTokenTransferDestination(
    rpc: Rpc<GetAccountInfoApi>,
    input: AssertValidTokenTransferDestinationInput,
    config?: AssertValidTokenTransferDestinationConfig,
): Promise<void> {
    const mint = getAddressFromResolvedInstructionAccount('mint', input.mint);
    const destination = getAddressFromResolvedInstructionAccount('destination', input.destination);
    const recipient = getAddressFromResolvedInstructionAccount('recipient', input.recipient);
    const {
        allowOffCurve = true,
        allowUnfundedRecipient = false,
        programOwner = SYSTEM_PROGRAM_ADDRESS,
        allowNonAssociatedTokenAccount = false,
        allowMissingAssociatedTokenAccount = true,
        tokenProgram: tokenProgramInput = TOKEN_2022_PROGRAM_ADDRESS,
        associatedTokenProgram,
        ...fetchConfig
    } = config ?? {};
    const tokenProgram = getAddressFromResolvedInstructionAccount('tokenProgram', tokenProgramInput);
    const [recipientAccount, destinationAccount, [ata]] = await Promise.all([
        fetchEncodedAccount(rpc, recipient, fetchConfig),
        fetchEncodedAccount(rpc, destination, fetchConfig),
        findAssociatedTokenPda({ owner: recipient, mint, tokenProgram }, { programAddress: associatedTokenProgram }),
    ]);

    if (recipientAccount.exists) {
        if (recipientAccount.programAddress !== programOwner) {
            throw new InvalidTokenTransferDestinationError(
                `Refusing to transfer tokens to ${recipient}: it is owned by program ${recipientAccount.programAddress}, not the expected program (${programOwner}).`,
                destination,
                recipient,
                { reason: 'unexpected-owner', owner: recipientAccount.programAddress },
            );
        }
    } else if (!allowUnfundedRecipient) {
        throw new InvalidTokenTransferDestinationError(
            `Refusing to transfer tokens to ${recipient}: it has no account on-chain yet, which often means the address is mistyped. If you intend to send to a new wallet, pass { allowUnfundedRecipient: true }.`,
            destination,
            recipient,
            { reason: 'unfunded-recipient' },
        );
    }

    if (!allowOffCurve && isOffCurveAddress(recipient)) {
        throw new InvalidTokenTransferDestinationError(
            `Refusing to transfer tokens to ${recipient}: it is an off-curve (program-derived) address, which no keypair controls. It may be a program-controlled account such as a multisig or smart wallet; to allow it, pass { allowOffCurve: true }.`,
            destination,
            recipient,
            { reason: 'off-curve' },
        );
    }

    const isAssociatedTokenAccount = destination === ata;
    if (!isAssociatedTokenAccount && !allowNonAssociatedTokenAccount) {
        throw new InvalidTokenTransferDestinationError(
            `Refusing to transfer tokens to ${destination}: it is not the associated token account of ${recipient} for mint ${mint} (ATA is: ${ata}). To send to another token account owned by the recipient, pass { allowNonAssociatedTokenAccount: true }.`,
            destination,
            recipient,
            { reason: 'ata-mismatch' },
        );
    }

    if (!destinationAccount.exists) {
        if (isAssociatedTokenAccount && allowMissingAssociatedTokenAccount) return;
        throw new InvalidTokenTransferDestinationError(
            isAssociatedTokenAccount
                ? `Refusing to transfer tokens to ${destination}: the associated token account has no account on-chain yet. To create it as part of the transfer, pass { allowMissingAssociatedTokenAccount: true }.`
                : `Refusing to transfer tokens to ${destination}: it has no account on-chain, and only an associated token account can be created as part of the transfer.`,
            destination,
            recipient,
            { reason: 'missing-token-account' },
        );
    }

    const token =
        destinationAccount.programAddress === tokenProgram && isTokenAccountData(destinationAccount.data, tokenProgram)
            ? decodeToken(destinationAccount).data
            : null;
    if (!token || token.state === AccountState.Uninitialized) {
        throw new InvalidTokenTransferDestinationError(
            `Refusing to transfer tokens to ${destination}: it is not an initialized token account.`,
            destination,
            recipient,
            { reason: 'not-token-account' },
        );
    }
    if (token.mint !== mint) {
        throw new InvalidTokenTransferDestinationError(
            `Refusing to transfer tokens to ${destination}: it holds mint ${token.mint}, not the expected mint (${mint}).`,
            destination,
            recipient,
            { reason: 'mint-mismatch', mint: token.mint },
        );
    }
    if (token.owner !== recipient) {
        throw new InvalidTokenTransferDestinationError(
            `Refusing to transfer tokens to ${destination}: it is owned by ${token.owner}, not the recipient ${recipient}.`,
            destination,
            recipient,
            { reason: 'token-owner-mismatch', tokenOwner: token.owner },
        );
    }
    if (token.state === AccountState.Frozen) {
        throw new InvalidTokenTransferDestinationError(
            `Refusing to transfer tokens to ${destination}: the token account is frozen, so the transfer would fail.`,
            destination,
            recipient,
            { reason: 'frozen' },
        );
    }
}
