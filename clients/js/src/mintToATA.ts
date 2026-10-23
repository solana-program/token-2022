import { Address, HasAddress, InstructionPlan, sequentialInstructionPlan, TransactionSigner } from '@solana/kit';
import {
    getAddressFromResolvedInstructionAccount,
    type InstructionAccountInput,
    type InstructionSignerInput,
} from '@solana/kit/program-client-core';

import {
    findAssociatedTokenPda,
    getCreateAssociatedTokenIdempotentInstruction,
    getMintToCheckedInstruction,
    TOKEN_2022_PROGRAM_ADDRESS,
} from './generated';
import { MakeOptional } from './types';

export type MintToATAInstructionPlanInput = {
    /** Funding account (must be a system account). */
    payer: TransactionSigner;
    /**
     * Associated token account address to mint to.
     * Will be created if it does not already exist.
     * Note: Use {@link getMintToATAInstructionPlanAsync} instead to derive this automatically.
     * Note: Use {@link findAssociatedTokenPda} to derive the associated token account address.
     */
    ata: InstructionAccountInput;
    /** Wallet address for the associated token account. */
    owner: InstructionAccountInput;
    /** The token mint for the associated token account. */
    mint: InstructionAccountInput;
    /** The mint's minting authority or its multisignature account. */
    mintAuthority: InstructionAccountInput | InstructionSignerInput;
    /** The amount of new tokens to mint. */
    amount: number | bigint;
    /** Expected number of base 10 digits to the right of the decimal place. */
    decimals: number;
    multiSigners?: Array<TransactionSigner>;
};

export type MintToATAInstructionPlanConfig = {
    systemProgram?: Address | HasAddress;
    tokenProgram?: Address | HasAddress;
    associatedTokenProgram?: Address | HasAddress;
};

export function getMintToATAInstructionPlan(
    input: MintToATAInstructionPlanInput,
    config?: MintToATAInstructionPlanConfig,
): InstructionPlan {
    return sequentialInstructionPlan([
        getCreateAssociatedTokenIdempotentInstruction(
            {
                payer: input.payer,
                ata: input.ata,
                owner: input.owner,
                mint: input.mint,
                systemProgram: config?.systemProgram,
                tokenProgram: config?.tokenProgram ?? TOKEN_2022_PROGRAM_ADDRESS,
            },
            {
                programAddress: config?.associatedTokenProgram,
            },
        ),
        getMintToCheckedInstruction(
            {
                mint: input.mint,
                token: input.ata,
                mintAuthority: input.mintAuthority,
                amount: input.amount,
                decimals: input.decimals,
                multiSigners: input.multiSigners,
            },
            {
                programAddress: config?.tokenProgram,
            },
        ),
    ]);
}

export type MintToATAInstructionPlanAsyncInput = MakeOptional<MintToATAInstructionPlanInput, 'ata'>;

export async function getMintToATAInstructionPlanAsync(
    input: MintToATAInstructionPlanAsyncInput,
    config?: MintToATAInstructionPlanConfig,
): Promise<InstructionPlan> {
    const tokenProgram = config?.tokenProgram ?? TOKEN_2022_PROGRAM_ADDRESS;
    let ata = input.ata;
    if (!ata) {
        [ata] = await findAssociatedTokenPda({
            owner: getAddressFromResolvedInstructionAccount('owner', input.owner),
            tokenProgram,
            mint: getAddressFromResolvedInstructionAccount('mint', input.mint),
        });
    }
    return getMintToATAInstructionPlan(
        {
            ...input,
            ata,
        },
        config,
    );
}
