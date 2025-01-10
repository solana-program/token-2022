#!/usr/bin/env zx
import 'zx/globals';
import { cliArguments, workingDirectory } from '../utils.mjs';

const [folder, ...args] = cliArguments();

// Start the local validator, or restart it if it is already running.
await $`pnpm validator:restart`;

// Build the client and run the tests.
cd(path.join(workingDirectory, folder));
await $`pnpm install`;
await $`pnpm build`;
await $`pnpm test ${args}`;
