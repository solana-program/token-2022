#!/usr/bin/env zx
import 'zx/globals';
import {
  cliArguments,
  workingDirectory,
} from '../utils.mjs';

const [folder, ...args] = cliArguments();
const sbfOutDir = path.join(workingDirectory, 'target', 'deploy');
const manifestPath = path.join(workingDirectory, folder, 'Cargo.toml');

await $`RUST_LOG=error SBF_OUT_DIR=${sbfOutDir} cargo test --manifest-path ${manifestPath} ${args}`;
