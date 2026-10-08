import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { expect, it } from 'vitest';

it('runs the mint-with-metadata example against the local validator', async () => {
    const { stdout } = await promisify(execFile)(process.execPath, [
        path.resolve(__dirname, '../examples/createMintWithMetadata.mjs'),
    ]);

    expect(stdout).toContain('Mint:');
    expect(stdout).toContain("__kind: 'MetadataPointer'");
    expect(stdout).toContain("__kind: 'TokenMetadata'");
    expect(stdout).toContain("name: 'My Token'");
    expect(stdout).toContain("symbol: 'MYT'");
    expect(stdout).toContain("uri: 'https://example.com/my-token.json'");
});
