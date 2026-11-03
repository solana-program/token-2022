import { unwrapOption, type Account, type Address, type ReadonlyUint8Array } from '@solana/kit';

import { AccountState, extension, getTokenEncoder, type Extension, type ExtensionArgs, type Mint } from './generated';
import { TOKEN_PROGRAM_ADDRESS } from './legacyToken';

// Mirrors `ExtensionType::get_required_init_account_extensions` in `interface/src/extension/mod.rs`.
const REQUIRED_ACCOUNT_EXTENSIONS: Partial<Record<Extension['__kind'], ExtensionArgs[]>> = {
    NonTransferable: [extension('NonTransferableAccount', {}), extension('ImmutableOwner', {})],
    PausableConfig: [extension('PausableAccount', {})],
    TransferFeeConfig: [extension('TransferFeeAmount', { withheldAmount: 0n })],
    TransferHook: [extension('TransferHookAccount', { transferring: false })],
};

/** The data the associated token program writes to a new associated token account for `mint` and `owner`. */
export function getNewAssociatedTokenAccountData(mint: Account<Mint>, owner: Address): ReadonlyUint8Array {
    const base = {
        amount: 0n,
        closeAuthority: null,
        delegate: null,
        delegatedAmount: 0n,
        isNative: null,
        mint: mint.address,
        owner,
    };
    if (mint.programAddress === TOKEN_PROGRAM_ADDRESS) {
        return getTokenEncoder().encode({ ...base, extensions: null, state: AccountState.Initialized });
    }
    const extensions: ExtensionArgs[] = [extension('ImmutableOwner', {})];
    let state = AccountState.Initialized;
    for (const mintExtension of unwrapOption(mint.data.extensions) ?? []) {
        if (mintExtension.__kind === 'DefaultAccountState') {
            state = mintExtension.state;
        }
        for (const accountExtension of REQUIRED_ACCOUNT_EXTENSIONS[mintExtension.__kind] ?? []) {
            if (!extensions.some(({ __kind }) => __kind === accountExtension.__kind)) {
                extensions.push(accountExtension);
            }
        }
    }
    return getTokenEncoder().encode({ ...base, extensions, state });
}
