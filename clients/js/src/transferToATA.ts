import {
    Address,
    ClientWithRpc,
    GetAccountInfoApi,
    InstructionPlan,
    sequentialInstructionPlan,
    TransactionSigner,
} from '@solana/kit';

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
    mint: Address;
    /** The source account for the transfer. */
    source: Address;
    /** The source account's owner/delegate or its multisignature account. */
    authority: Address | TransactionSigner;
    /**
     * Associated token account address to transfer to.
     * Will be created if it does not already exist.
     * Note: Use {@link getTransferToATAInstructionPlanAsync} instead to derive this automatically.
     * Note: Use {@link findAssociatedTokenPda} to derive the associated token account address.
     */
    destination: Address;
    /** Wallet address for the destination. */
    recipient: Address;
    /** The amount of tokens to transfer. */
    amount: number | bigint;
    /** Expected number of base 10 digits to the right of the decimal place. */
    decimals: number;
    multiSigners?: Array<TransactionSigner>;
};

export type TransferToATAInstructionPlanConfig = {
    systemProgram?: Address;
    tokenProgram?: Address;
    associatedTokenProgram?: Address;
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

    let destination = input.destination;
    if (!destination) {
        [destination] = await findAssociatedTokenPda(
            {
                owner: input.recipient,
                tokenProgram,
                mint: input.mint,
            },
            { programAddress: config?.associatedTokenProgram },
        );
    }

    let source = input.source;
    if (!source) {
        const authorityAddress: Address =
            typeof input.authority === 'string' ? input.authority : input.authority.address;
        const [sourceAta] = await findAssociatedTokenPda(
            {
                owner: authorityAddress,
                tokenProgram,
                mint: input.mint,
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
