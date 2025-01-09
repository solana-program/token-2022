#!/usr/bin/env zx
import 'zx/globals';
import {
  cliArguments,
  getToolchainArgument,
  partitionArguments,
  popArgument,
  workingDirectory,
} from '../utils.mjs';

const [folder, ...formatArgs] = cliArguments();

const fix = popArgument(formatArgs, '--fix');
const [cargoArgs, fmtArgs] = partitionArguments(formatArgs, '--');
const toolchain = getToolchainArgument('format');

const manifestPath = path.join(workingDirectory, folder, 'Cargo.toml');

if (fix) {
  await $`cargo ${toolchain} fmt --manifest-path ${manifestPath} ${cargoArgs} -- ${fmtArgs}`;
} else {
  await $`cargo ${toolchain} fmt --manifest-path ${manifestPath} ${cargoArgs} -- --check ${fmtArgs}`;
}
