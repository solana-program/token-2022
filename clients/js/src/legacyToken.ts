import { Address } from '@solana/kit';

/**
 * The address of the legacy SPL Token program.
 *
 * The Token-2022 client is backwards-compatible with the legacy SPL Token
 * program, so this address is re-exported here for convenience — pass it as the
 * `programAddress` of an instruction (or the `tokenProgram` of an
 * associated-token helper) to target the legacy program from this client.
 */
export const TOKEN_PROGRAM_ADDRESS =
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as Address<'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'>;
