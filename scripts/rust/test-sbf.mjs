#!/usr/bin/env zx
import 'zx/globals';
import {
  cliArguments,
  workingDirectory,
} from '../utils.mjs';

const [folder, ...args] = cliArguments();
const manifestPath = path.join(workingDirectory, folder, 'Cargo.toml');

await $`RUST_LOG=error cargo test-sbf --manifest-path ${manifestPath} ${args}`;
