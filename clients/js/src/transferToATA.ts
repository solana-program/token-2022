import {
    Address,
    ClientWithRpc,
    GetAccountInfoApi,
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

import {
    findAssociatedTokenPda,
    getCreateAssociatedTokenIdempotentInstruction,
    getTransferCheckedInstruction,
    TOKEN_2022_PROGRAM_ADDRESS,
} from './generated';
import { getTransferCheckedWithTransferHookInstructionAsync } from './transferHookExtraAccountMetas';
import { MakeOptional } from './types';

export type TransferToATAInstructionPlanInput = {
    /** Funding account (must be a system account). */
    payer: TransactionSigner;
    /** The token mint to transfer. */
    mint: InstructionAccountInput;
    /** The source account for the transfer. */
    source: InstructionAccountInput;
    /** The source account's owner/delegate or its multisignature account. */
    authority: InstructionAccountInput | InstructionSignerInput;
    /**
     * Associated token account address to transfer to.
     * Will be created if it does not already exist.
     * Note: Use {@link getTransferToATAInstructionPlanAsync} instead to derive this automatically.
     * Note: Use {@link findAssociatedTokenPda} to derive the associated token account address.
     */
    destination: InstructionAccountInput;
    /** Wallet address for the destination. */
    recipient: InstructionAccountInput;
    /** The amount of tokens to transfer. */
    amount: number | bigint;
    /** Expected number of base 10 digits to the right of the decimal place. */
    decimals: number;
    multiSigners?: Array<TransactionSigner>;
};

export type TransferToATAInstructionPlanConfig = {
    systemProgram?: Address | HasAddress;
    tokenProgram?: Address | HasAddress;
    associatedTokenProgram?: Address | HasAddress;
};

function getCreateDestinationInstruction(
    input: TransferToATAInstructionPlanInput,
    config?: TransferToATAInstructionPlanConfig,
) {
    return getCreateAssociatedTokenIdempotentInstruction(
        {
            payer: input.payer,
            ata: input.destination,
            owner: input.recipient,
            mint: input.mint,
            systemProgram: config?.systemProgram,
            tokenProgram: config?.tokenProgram ?? TOKEN_2022_PROGRAM_ADDRESS,
        },
        {
            programAddress: config?.associatedTokenProgram,
        },
    );
}

export function getTransferToATAInstructionPlan(
    input: TransferToATAInstructionPlanInput,
    config?: TransferToATAInstructionPlanConfig,
): InstructionPlan {
    return sequentialInstructionPlan([
        getCreateDestinationInstruction(input, config),
        getTransferCheckedInstruction(
            {
                source: input.source,
                mint: input.mint,
                destination: input.destination,
                authority: input.authority,
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

export type TransferToATAInstructionPlanAsyncInput = MakeOptional<
    TransferToATAInstructionPlanInput,
    'source' | 'destination'
>;

async function resolveTransferToATAInput(
    input: TransferToATAInstructionPlanAsyncInput,
    config?: TransferToATAInstructionPlanConfig,
): Promise<TransferToATAInstructionPlanInput> {
    const tokenProgram = config?.tokenProgram ?? TOKEN_2022_PROGRAM_ADDRESS;

    const mint = getAddressFromResolvedInstructionAccount('mint', input.mint);

    let destination = input.destination;
    if (!destination) {
        [destination] = await findAssociatedTokenPda(
            {
                owner: getAddressFromResolvedInstructionAccount('recipient', input.recipient),
                tokenProgram,
                mint,
            },
            { programAddress: config?.associatedTokenProgram },
        );
    }

    let source = input.source;
    if (!source) {
        const [sourceAta] = await findAssociatedTokenPda(
            {
                owner: getAddressFromResolvedInstructionAccount('authority', input.authority),
                tokenProgram,
                mint,
            },
            { programAddress: config?.associatedTokenProgram },
        );
        source = sourceAta;
    }

    return { ...input, source, destination };
}

export async function getTransferToATAInstructionPlanAsync(
    input: TransferToATAInstructionPlanAsyncInput,
    config?: TransferToATAInstructionPlanConfig,
): Promise<InstructionPlan> {
    return getTransferToATAInstructionPlan(await resolveTransferToATAInput(input, config), config);
}

/**
 * Like {@link getTransferToATAInstructionPlanAsync}, but the transfer carries the extra accounts
 * the mint's transfer hook needs, resolved against the destination this plan creates.
 */
export async function getTransferToATAWithTransferHookInstructionPlanAsync(
    client: ClientWithRpc<GetAccountInfoApi>,
    input: TransferToATAInstructionPlanAsyncInput,
    config?: TransferToATAInstructionPlanConfig,
): Promise<InstructionPlan> {
    const resolved = await resolveTransferToATAInput(input, config);
    const transfer = await getTransferCheckedWithTransferHookInstructionAsync(
        client,
        {
            source: resolved.source,
            mint: resolved.mint,
            destination: resolved.destination,
            authority: resolved.authority,
            amount: resolved.amount,
            decimals: resolved.decimals,
            multiSigners: resolved.multiSigners,
        },
        {
            associatedTokenProgram: config?.associatedTokenProgram,
            recipient: resolved.recipient,
            tokenProgram: config?.tokenProgram,
        },
    );
    return sequentialInstructionPlan([getCreateDestinationInstruction(resolved, config), transfer]);
}
