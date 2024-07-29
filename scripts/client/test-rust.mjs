#!/usr/bin/env zx
import 'zx/globals';
import { cliArguments, workingDirectory } from '../utils.mjs';

// Configure additional arguments here, e.g.:
// ['--arg1', '--arg2', ...cliArguments()]
const testArgs = cliArguments();

const hasSolfmt = await which('solfmt', { nothrow: true });

// Run the tests.
cd(path.join(workingDirectory, 'clients', 'rust'));
if (hasSolfmt) {
  await $`cargo test-sbf ${testArgs} 2>&1 | solfmt`;
} else {
  await $`cargo test-sbf ${testArgs}`;
}
