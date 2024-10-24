#!/usr/bin/env zx
import 'zx/globals';
import { cliArguments, workingDirectory } from '../utils.mjs';

// Configure additional arguments here, e.g.:
// ['--arg1', '--arg2', ...cliArguments()]
const testArgs = cliArguments();

const hasSolfmt = await which('solfmt', { nothrow: true });
const sbfOutDir = path.join(workingDirectory, 'target', 'deploy');

// Run the tests.
cd(path.join(workingDirectory, 'clients', 'rust'));
if (hasSolfmt) {
  await $`SBF_OUT_DIR=${sbfOutDir} cargo test --features "test-sbf" ${testArgs} 2>&1 | solfmt`;
} else {
  await $`SBF_OUT_DIR=${sbfOutDir} cargo test --features "test-sbf" ${testArgs}`;
}
