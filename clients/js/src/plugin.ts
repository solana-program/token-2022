import { ClientWithPayer, extendClient, pipe } from '@solana/kit';
import { addSelfPlanAndSendFunctions, SelfPlanAndSendFunctions } from '@solana/kit/program-client-core';

import { getBatchInstruction } from './batch';
import {
    CreateMintInstructionPlanConfig,
    CreateMintInstructionPlanInput,
    getCreateMintInstructionPlan,
} from './createMint';
import {
    CreateTokenInstructionPlanConfig,
    CreateTokenInstructionPlanInput,
    getCreateTokenInstructionPlan,
} from './createToken';
import {
    Token2022Plugin as GeneratedToken2022Plugin,
    Token2022PluginInstructions as GeneratedToken2022PluginInstructions,
    Token2022PluginRequirements as GeneratedToken2022PluginRequirements,
    token2022Program as generatedToken2022Program,
} from './generated';
import {
    getMintToATAInstructionPlanAsync,
    MintToATAInstructionPlanAsyncInput,
    MintToATAInstructionPlanConfig,
} from './mintToATA';
import {
    getTransferToATAInstructionPlanAsync,
    TransferToATAInstructionPlanAsyncInput,
    TransferToATAInstructionPlanConfig,
} from './transferToATA';
import { MakeOptional } from './types';

export type Token2022PluginRequirements = GeneratedToken2022PluginRequirements & ClientWithPayer;

export type Token2022Plugin = Omit<GeneratedToken2022Plugin, 'instructions'> & {
    instructions: Token2022PluginInstructions;
};

export type Token2022PluginInstructions = Omit<GeneratedToken2022PluginInstructions, 'batch'> & {
    /** Batch multiple instructions into one by using other token instructions as children. */
    batch: (
        instructions: Parameters<typeof getBatchInstruction>[0],
        config?: Parameters<typeof getBatchInstruction>[1],
    ) => ReturnType<typeof getBatchInstruction> & SelfPlanAndSendFunctions;
    /** Create a new token mint, optionally with extensions. */
    createMint: (
        input: MakeOptional<CreateMintInstructionPlanInput, 'payer'>,
        config?: CreateMintInstructionPlanConfig,
    ) => ReturnType<typeof getCreateMintInstructionPlan> & SelfPlanAndSendFunctions;
    /** Create a new token account, optionally with extensions. */
    createToken: (
        input: MakeOptional<CreateTokenInstructionPlanInput, 'payer'>,
        config?: CreateTokenInstructionPlanConfig,
    ) => ReturnType<typeof getCreateTokenInstructionPlan> & SelfPlanAndSendFunctions;
    /** Mint tokens to an owner's ATA (created if needed). */
    mintToATA: (
        input: MakeOptional<MintToATAInstructionPlanAsyncInput, 'payer'>,
        config?: MintToATAInstructionPlanConfig,
    ) => ReturnType<typeof getMintToATAInstructionPlanAsync> & SelfPlanAndSendFunctions;
    /** Transfer tokens to a recipient's ATA (created if needed). */
    transferToATA: (
        input: MakeOptional<TransferToATAInstructionPlanAsyncInput, 'payer'>,
        config?: TransferToATAInstructionPlanConfig,
    ) => ReturnType<typeof getTransferToATAInstructionPlanAsync> & SelfPlanAndSendFunctions;
};

export function token2022Program() {
    return <T extends Token2022PluginRequirements>(client: T) => {
        return pipe(client, generatedToken2022Program(), c =>
            extendClient(c, {
                token2022: <Token2022Plugin>{
                    ...c.token2022,
                    instructions: {
                        ...c.token2022.instructions,
                        batch: (input, config) =>
                            addSelfPlanAndSendFunctions(client, getBatchInstruction(input, config)),
                        createMint: (input, config) =>
                            addSelfPlanAndSendFunctions(
                                client,
                                getCreateMintInstructionPlan({ ...input, payer: input.payer ?? client.payer }, config),
                            ),
                        createToken: (input, config) =>
                            addSelfPlanAndSendFunctions(
                                client,
                                getCreateTokenInstructionPlan({ ...input, payer: input.payer ?? client.payer }, config),
                            ),
                        mintToATA: (input, config) =>
                            addSelfPlanAndSendFunctions(
                                client,
                                getMintToATAInstructionPlanAsync(
                                    { ...input, payer: input.payer ?? client.payer },
                                    config,
                                ),
                            ),
                        transferToATA: (input, config) =>
                            addSelfPlanAndSendFunctions(
                                client,
                                getTransferToATAInstructionPlanAsync(
                                    { ...input, payer: input.payer ?? client.payer },
                                    config,
                                ),
                            ),
                    },
                },
            }),
        );
    };
}
