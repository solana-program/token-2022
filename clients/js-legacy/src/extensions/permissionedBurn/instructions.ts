import { struct, u8 } from '@solana/buffer-layout';
import { publicKey, u64 } from '@solana/buffer-layout-utils';
import type { PublicKey, Signer } from '@solana/web3.js';
import { TransactionInstruction } from '@solana/web3.js';
import { programSupportsExtensions, TOKEN_2022_PROGRAM_ID } from '../../constants.js';
import { TokenUnsupportedInstructionError } from '../../errors.js';
import { addSigners } from '../../instructions/internal.js';
import { TokenInstruction } from '../../instructions/types.js';

export enum PermissionedBurnInstruction {
    Initialize = 0,
    Burn = 1,
    BurnChecked = 2,
}

interface InitializePermissionedBurnInstructionData {
    instruction: TokenInstruction.PermissionedBurnExtension;
    permissionedBurnInstruction: PermissionedBurnInstruction.Initialize;
    authority: PublicKey;
}

const initializePermissionedBurnInstructionData = struct<InitializePermissionedBurnInstructionData>([
    u8('instruction'),
    u8('permissionedBurnInstruction'),
    publicKey('authority'),
]);

/**
 * Construct a InitializePermissionedBurnConfig instruction
 *
 * @param mint          Token mint account
 * @param authority     The permissioned burn mint's authority
 * @param programId     SPL Token program account
 */
export function createInitializePermissionedBurnInstruction(
    mint: PublicKey,
    authority: PublicKey,
    programId = TOKEN_2022_PROGRAM_ID,
): TransactionInstruction {
    if (!programSupportsExtensions(programId)) {
        throw new TokenUnsupportedInstructionError();
    }

    const keys = [{ pubkey: mint, isSigner: false, isWritable: true }];
    const data = Buffer.alloc(initializePermissionedBurnInstructionData.span);
    initializePermissionedBurnInstructionData.encode(
        {
            instruction: TokenInstruction.PermissionedBurnExtension,
            permissionedBurnInstruction: PermissionedBurnInstruction.Initialize,
            authority,
        },
        data,
    );

    return new TransactionInstruction({ keys, programId, data });
}

interface PermissionedBurnInstructionData {
    instruction: TokenInstruction.PermissionedBurnExtension;
    permissionedBurnInstruction: PermissionedBurnInstruction.Burn;
    amount: bigint;
}

const permissionedBurnInstructionData = struct<PermissionedBurnInstructionData>([
    u8('instruction'),
    u8('permissionedBurnInstruction'),
    u64('amount'),
]);

/**
 * Construct a permissioned burn instruction
 *
 * @param account                       Token account to update
 * @param mint                          Token mint account
 * @param owner                         The account's owner/delegate
 * @param permissionedBurnAuthority     Authority configured on the mint for permissioned burns
 * @param amount                        Amount to burn
 * @param multiSigners                  The signer account(s)
 * @param programId                     SPL Token program account
 */
export function createPermissionedBurnInstruction(
    account: PublicKey,
    mint: PublicKey,
    owner: PublicKey,
    permissionedBurnAuthority: PublicKey,
    amount: number | bigint,
    multiSigners: (Signer | PublicKey)[] = [],
    programId = TOKEN_2022_PROGRAM_ID,
): TransactionInstruction {
    if (!programSupportsExtensions(programId)) {
        throw new TokenUnsupportedInstructionError();
    }

    const keys = addSigners(
        [
            { pubkey: account, isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: true },
            { pubkey: permissionedBurnAuthority, isSigner: true, isWritable: false },
        ],
        owner,
        multiSigners,
    );

    const data = Buffer.alloc(permissionedBurnInstructionData.span);
    permissionedBurnInstructionData.encode(
        {
            instruction: TokenInstruction.PermissionedBurnExtension,
            permissionedBurnInstruction: PermissionedBurnInstruction.Burn,
            amount: BigInt(amount),
        },
        data,
    );

    return new TransactionInstruction({ keys, programId, data });
}

interface PermissionedBurnCheckedInstructionData {
    instruction: TokenInstruction.PermissionedBurnExtension;
    permissionedBurnInstruction: PermissionedBurnInstruction.BurnChecked;
    amount: bigint;
    decimals: number;
}

const permissionedBurnCheckedInstructionData = struct<PermissionedBurnCheckedInstructionData>([
    u8('instruction'),
    u8('permissionedBurnInstruction'),
    u64('amount'),
    u8('decimals'),
]);

/**
 * Construct a checked permissioned burn instruction
 *
 * @param account                       Token account to update
 * @param mint                          Token mint account
 * @param owner                         The account's owner/delegate
 * @param permissionedBurnAuthority     Authority configured on the mint for permissioned burns
 * @param amount                        Amount to burn
 * @param decimals                      Number of the decimals of the mint
 * @param multiSigners                  The signer account(s)
 * @param programId                     SPL Token program account
 */
export function createPermissionedBurnCheckedInstruction(
    account: PublicKey,
    mint: PublicKey,
    owner: PublicKey,
    permissionedBurnAuthority: PublicKey,
    amount: number | bigint,
    decimals: number,
    multiSigners: (Signer | PublicKey)[] = [],
    programId = TOKEN_2022_PROGRAM_ID,
): TransactionInstruction {
    if (!programSupportsExtensions(programId)) {
        throw new TokenUnsupportedInstructionError();
    }

    const keys = addSigners(
        [
            { pubkey: account, isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: true },
            { pubkey: permissionedBurnAuthority, isSigner: true, isWritable: false },
        ],
        owner,
        multiSigners,
    );

    const data = Buffer.alloc(permissionedBurnCheckedInstructionData.span);
    permissionedBurnCheckedInstructionData.encode(
        {
            instruction: TokenInstruction.PermissionedBurnExtension,
            permissionedBurnInstruction: PermissionedBurnInstruction.BurnChecked,
            amount: BigInt(amount),
            decimals,
        },
        data,
    );

    return new TransactionInstruction({ keys, programId, data });
}
