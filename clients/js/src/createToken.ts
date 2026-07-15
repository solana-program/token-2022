import { getCreateAccountInstruction } from '@solana-program/system';
import {
    Address,
    ClientWithGetMinimumBalance,
    InstructionPlan,
    sequentialInstructionPlan,
    TransactionSigner,
} from '@solana/kit';

import { ExtensionArgs, getInitializeAccountInstruction, TOKEN_2022_PROGRAM_ADDRESS } from './generated';
import { getPostInitializeInstructionsForTokenExtensions } from './getInitializeInstructionsForExtensions';
import { getTokenSize } from './getTokenSize';

export type CreateTokenInstructionPlanInput = {
    /** Funding account (must be a system account). */
    payer: TransactionSigner;
    /** New token account to create. */
    newToken: TransactionSigner;
    /** The token mint for the token account. */
    mint: Address;
    /** The owner of the token account. */
    owner: TransactionSigner | Address;
    /** The optional token-account extensions to initialize on the account. */
    extensions?: ExtensionArgs[];
    multiSigners?: TransactionSigner[];
    /**
     * Optional override for the amount of Lamports to fund the token account with.
     * @default enough to make the account rent-exempt
     */
    tokenAccountLamports?: number | bigint;
};

export type CreateTokenInstructionPlanConfig = {
    systemProgram?: Address;
    tokenProgram?: Address;
};

export async function getCreateTokenInstructionPlan(
    client: ClientWithGetMinimumBalance,
    input: CreateTokenInstructionPlanInput,
    config?: CreateTokenInstructionPlanConfig,
): Promise<InstructionPlan> {
    const extensions = input.extensions ?? [];
    const space = getTokenSize(input.extensions);
    const owner = typeof input.owner === 'string' ? input.owner : input.owner.address;
    const lamports = input.tokenAccountLamports ?? (await client.getMinimumBalance(space));
    return sequentialInstructionPlan([
        getCreateAccountInstruction(
            {
                payer: input.payer,
                newAccount: input.newToken,
                lamports,
                space,
                programAddress: config?.tokenProgram ?? TOKEN_2022_PROGRAM_ADDRESS,
            },
            {
                programAddress: config?.systemProgram,
            },
        ),
        getInitializeAccountInstruction(
            {
                account: input.newToken.address,
                mint: input.mint,
                owner,
            },
            {
                programAddress: config?.tokenProgram,
            },
        ),
        ...getPostInitializeInstructionsForTokenExtensions(
            input.newToken.address,
            input.owner,
            extensions,
            input.multiSigners,
        ),
    ]);
}
