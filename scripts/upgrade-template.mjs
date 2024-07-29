#!/usr/bin/env zx
import 'zx/globals';
import { getCargo } from './utils.mjs';

// Arguments to pass to the `create-solana-program` command.
const rustClientCargo = getCargo(path.join('clients', 'rust'));
const jsClientPkg = require(
  path.join(__dirname, '..', 'clients', 'js', 'package.json')
);
const templateArgs = [
  'token-2022',
  '--address',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  '--org',
  'solana-program',
  '--rust-client-crate-name',
  rustClientCargo.package.name,
  '--js-client-package-name',
  jsClientPkg.name,
  '--default',
  '--force',
];

// File and folder patterns that should not be overwritten by the template upgrade.
const unchangedGlobs = [
  'clients/**/src/**',
  'clients/**/src/*',
  'clients/js/test/*',
  'clients/rust/tests/*',
  'program/**/*',
  'program/*',
  'scripts/generate-clients.mjs',
  'scripts/generate-idls.mjs',
  'scripts/upgrade-template.mjs',
  'scripts/program/*',
  'Cargo.lock',
  '**/pnpm-lock.yaml',
  'pnpm-lock.yaml',
];

// Prevent CLI arguments from being escaped.
$.quote = (command) => command;

// Re-generate the repo from the parent directory.
cd('..');
await $`pnpm create solana-program@latest ${templateArgs}`;

// Go back inside the updated repo.
cd('token-2022');

// Restore files and folders that should not be overwritten.
await $`git add --all`;
for (const glob of unchangedGlobs) {
  await $`git restore --worktree --staged "${glob}"`;
}

// Re-install dependencies.
await $`pnpm install`;
