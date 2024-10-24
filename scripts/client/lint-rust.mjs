#!/usr/bin/env zx
import 'zx/globals';
import {
  cliArguments,
  getToolchainArgument,
  popArgument,
  workingDirectory,
} from '../utils.mjs';

// Configure additional arguments here, e.g.:
// ['--arg1', '--arg2', ...cliArguments()]
const lintArgs = cliArguments();

const fix = popArgument(lintArgs, '--fix');
const toolchain = getToolchainArgument('lint');
const manifestPath = path.join(
  workingDirectory,
  'clients',
  'rust',
  'Cargo.toml'
);

// Check the client using Clippy.
if (fix) {
  await $`cargo ${toolchain} clippy --manifest-path ${manifestPath} --fix ${lintArgs}`;
} else {
  await $`cargo ${toolchain} clippy --manifest-path ${manifestPath} ${lintArgs}`;
}
