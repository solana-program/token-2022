import { getCreateAccountInstruction } from '@solana-program/system';
import {
    Address,
    ClientWithGetMinimumBalance,
    InstructionPlan,
    OptionOrNullable,
    sequentialInstructionPlan,
    TransactionSigner,
} from '@solana/kit';

import { Extension, ExtensionArgs, getInitializeMintInstruction, TOKEN_2022_PROGRAM_ADDRESS } from './generated';
import {
    getPostInitializeInstructionsForMintExtensions,
    getPreInitializeInstructionsForMintExtensions,
} from './getInitializeInstructionsForExtensions';
import { getMintSize } from './getMintSize';

/**
 * Extensions whose data is initialized _after_ the mint and which grow the
 * account beyond its initially allocated space (they reallocate as needed).
 * The created account is therefore sized without them.
 */
const POST_INITIALIZE_EXTENSIONS: Extension['__kind'][] = ['TokenMetadata', 'TokenGroup', 'TokenGroupMember'];

export type CreateMintInstructionPlanInput = {
    /** Funding account (must be a system account). */
    payer: TransactionSigner;
    /** New mint account to create. */
    newMint: TransactionSigner;
    /**
     * Number of base 10 digits to the right of the decimal place.
     * @default 0
     */
    decimals?: number;
    /** The authority/multisignature to mint tokens and to configure extensions. */
    mintAuthority: TransactionSigner;
    /** The optional freeze authority/multisignature of the mint. */
    freezeAuthority?: OptionOrNullable<Address>;
    /** The optional mint extensions to initialize on the account. */
    extensions?: ExtensionArgs[];
    /**
     * Optional override for the amount of Lamports to fund the mint account with.
     * @default enough to make the account rent-exempt
     */
    mintAccountLamports?: number | bigint;
};

export type CreateMintInstructionPlanConfig = {
    systemProgram?: Address;
    tokenProgram?: Address;
};

export async function getCreateMintInstructionPlan(
    client: ClientWithGetMinimumBalance,
    input: CreateMintInstructionPlanInput,
    config?: CreateMintInstructionPlanConfig,
): Promise<InstructionPlan> {
    const extensions = input.extensions ?? [];
    // The account is allocated without the post-initialize extensions (which
    // reallocate the account as needed). `undefined` (no extensions) must be
    // preserved so the size omits the extension TLV prefix entirely.
    const space = input.extensions
        ? getMintSize(input.extensions.filter(e => !POST_INITIALIZE_EXTENSIONS.includes(e.__kind)))
        : getMintSize();
    const rentSpace = getMintSize(input.extensions);
    const lamports = input.mintAccountLamports ?? (await client.getMinimumBalance(rentSpace));
    return sequentialInstructionPlan([
        getCreateAccountInstruction(
            {
                payer: input.payer,
                newAccount: input.newMint,
                lamports,
                space,
                programAddress: config?.tokenProgram ?? TOKEN_2022_PROGRAM_ADDRESS,
            },
            {
                programAddress: config?.systemProgram,
            },
        ),
        ...getPreInitializeInstructionsForMintExtensions(input.newMint.address, extensions),
        getInitializeMintInstruction(
            {
                mint: input.newMint.address,
                decimals: input.decimals ?? 0,
                mintAuthority: input.mintAuthority.address,
                freezeAuthority: input.freezeAuthority,
            },
            {
                programAddress: config?.tokenProgram,
            },
        ),
        ...getPostInitializeInstructionsForMintExtensions(input.newMint.address, input.mintAuthority, extensions),
    ]);
}
