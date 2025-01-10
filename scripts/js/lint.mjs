#!/usr/bin/env zx
import 'zx/globals';
import { cliArguments, workingDirectory } from '../utils.mjs';

const [folder, ...args] = cliArguments();

// Check the client using ESLint.
cd(path.join(workingDirectory, folder));
await $`pnpm install`;
await $`pnpm lint ${args}`;
