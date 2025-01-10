#!/usr/bin/env zx
import 'zx/globals';
import {
  cliArguments,
  workingDirectory,
} from '../utils.mjs';

const [folder, ...args] = cliArguments();
const manifestPath = path.join(workingDirectory, folder, 'Cargo.toml');
await $`cargo-build-sbf --manifest-path ${manifestPath} ${args}`;
