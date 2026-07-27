import { address, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';
import { expect, it } from 'vitest';

import { findExtraAccountMetaListPda, getExtraAccountMetas } from '../src';

const plainAddress = address('6c5q79ccBTWvZTEx3JkdHThtMa2eALba5bfvHGf8kA2c');
const transferHookProgramId = address('7N4HggYEJAtCLJdnHGCtFqfxcB5rhQCsQTze3ftYstVj');
const mint = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

function extraAccountMetaBytes(discriminator: number, addressConfig: Uint8Array, isSigner: boolean, isWritable: boolean) {
    return new Uint8Array([discriminator, ...addressConfig, isSigner ? 1 : 0, isWritable ? 1 : 0]);
}

it('finds the same PDA as a manual derivation off the "extra-account-metas" seed', async () => {
    const [expected] = await getProgramDerivedAddress({
        programAddress: transferHookProgramId,
        seeds: ['extra-account-metas', getAddressEncoder().encode(mint)],
    });

    const [actual] = await findExtraAccountMetaListPda({ mint }, { programAddress: transferHookProgramId });

    expect(actual).toBe(expected);
});

it('parses extra account metas from validation account data, ignoring trailing bytes past count', () => {
    const addressConfig = new Uint8Array(32);
    addressConfig.set(getAddressEncoder().encode(plainAddress), 0);

    const plainExtraAccount = extraAccountMetaBytes(0, addressConfig, false, false);
    const pdaExtraAccount = extraAccountMetaBytes(1, addressConfig, true, false);

    const data = new Uint8Array([
        ...new Array(8).fill(0), // u64 instructionDiscriminator
        ...new Array(4).fill(0), // u32 length
        1, 0, 0, 0, // u32 count -- only the first entry is "in bounds"
        ...plainExtraAccount,
        ...pdaExtraAccount, // trailing bytes past `count`, should be dropped
    ]);

    const parsed = getExtraAccountMetas(data);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].discriminator).toBe(0);
    expect(parsed[0].addressConfig).toEqual(addressConfig);
    expect(parsed[0].isSigner).toBe(false);
    expect(parsed[0].isWritable).toBe(false);
});
