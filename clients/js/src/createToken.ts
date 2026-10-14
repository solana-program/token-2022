import { getCreateAccountInstruction } from '@solana-program/system';
import {
    Address,
    ClientWithGetMinimumBalance,
    HasAddress,
    InstructionPlan,
    sequentialInstructionPlan,
    TransactionSigner,
} from '@solana/kit';
import {
    getAddressFromResolvedInstructionAccount,
    type InstructionAccountInput,
    type InstructionSignerInput,
} from '@solana/kit/program-client-core';

import { ExtensionArgs, getInitializeAccountInstruction, TOKEN_2022_PROGRAM_ADDRESS } from './generated';
import { getPostInitializeInstructionsForTokenExtensions } from './getInitializeInstructionsForExtensions';
import { getTokenSize } from './getTokenSize';

export type CreateTokenInstructionPlanInput = {
    /** Funding account (must be a system account). */
    payer: TransactionSigner;
    /** New token account to create. */
    newToken: TransactionSigner;
    /** The token mint for the token account. */
    mint: InstructionAccountInput;
    /** The owner of the token account. */
    owner: InstructionAccountInput | InstructionSignerInput;
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
    systemProgram?: Address | HasAddress;
    tokenProgram?: Address | HasAddress;
};

export async function getCreateTokenInstructionPlan(
    client: ClientWithGetMinimumBalance,
    input: CreateTokenInstructionPlanInput,
    config?: CreateTokenInstructionPlanConfig,
): Promise<InstructionPlan> {
    const extensions = input.extensions ?? [];
    const space = getTokenSize(input.extensions);
    const owner = getAddressFromResolvedInstructionAccount('owner', input.owner);
    const systemProgram =
        config?.systemProgram && getAddressFromResolvedInstructionAccount('systemProgram', config.systemProgram);
    const tokenProgram =
        config?.tokenProgram && getAddressFromResolvedInstructionAccount('tokenProgram', config.tokenProgram);
    const lamports = input.tokenAccountLamports ?? (await client.getMinimumBalance(space));
    return sequentialInstructionPlan([
        getCreateAccountInstruction(
            {
                payer: input.payer,
                newAccount: input.newToken,
                lamports,
                space,
                programAddress: tokenProgram ?? TOKEN_2022_PROGRAM_ADDRESS,
            },
            {
                programAddress: systemProgram,
            },
        ),
        getInitializeAccountInstruction(
            {
                account: input.newToken.address,
                mint: input.mint,
                owner,
            },
            {
                programAddress: tokenProgram,
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
