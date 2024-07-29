#!/usr/bin/env zx
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import 'zx/globals';
import {
  getCargo,
  getExternalAccountAddresses,
  getExternalProgramAddresses,
  getExternalProgramOutputDir,
  getProgramFolders,
} from './utils.mjs';

// Check Solana version.
await $`pnpm solana:check`;

// Options and arguments.
const restart = argv['restart'];

// Keep the validator running when not using the restart flag.
const isValidatorRunning = (await $`lsof -t -i:8899`.quiet().exitCode) === 0;
if (!restart && isValidatorRunning) {
  echo(chalk.yellow('Local validator is already running.'));
  process.exit();
}

// Initial message.
const verb = isValidatorRunning ? 'Restarting' : 'Starting';

// Get programs and accounts.
const programs = [...getPrograms(), ...getExternalPrograms()];
const programPluralized = programs.length === 1 ? 'program' : 'programs';
const accounts = [...getExternalAccounts()];
const accountsPluralized = accounts.length === 1 ? 'account' : 'accounts';

echo(
  `${verb} local validator with ${programs.length} custom ${programPluralized}` +
    (accounts.length > 0
      ? ` and ${accounts.length} external ${accountsPluralized}...`
      : `...`)
);

// Kill the validator if it's already running.
if (isValidatorRunning) {
  await $`pkill -f solana-test-validator`.quiet();
  await sleep(1000);
}

// Global validator arguments.
const args = [/* Reset ledger */ '-r'];

// Load programs.
programs.forEach(({ programId, deployPath }) => {
  args.push(/* Load BPF program */ '--bpf-program', programId, deployPath);
});

// Load accounts.
accounts.forEach(({ account, deployPath }) => {
  args.push(/* Load account */ '--account', account, deployPath);
});

// Start the validator in detached mode.
const cliLogs = path.join(os.tmpdir(), 'validator-cli.log');
fs.writeFileSync(cliLogs, '', () => {});
const out = fs.openSync(cliLogs, 'a');
const err = fs.openSync(cliLogs, 'a');
const validator = spawn('solana-test-validator', args, {
  detached: true,
  stdio: ['ignore', out, err],
});
validator.unref();

// Wait for the validator to stabilize.
const waitForValidator = spinner(
  'Waiting for local validator to stabilize...',
  () =>
    new Promise((resolve, reject) => {
      setInterval(() => {
        const logs = fs.readFileSync(cliLogs, 'utf8');
        if (validator.exitCode !== null) {
          reject(logs);
        } else if (logs.includes('Confirmed Slot: 1')) {
          resolve();
        }
      }, 1000);
    })
);

try {
  await waitForValidator;
  echo(chalk.green('Local validator is up and running!'));
} catch (error) {
  echo(error);
  echo(chalk.red('Could not start local validator.'));
} finally {
  fs.rmSync(cliLogs);
  process.exit();
}

function getPrograms() {
  const binaryDir = path.join(__dirname, '..', 'target', 'deploy');
  return getProgramFolders().map((folder) => {
    const cargo = getCargo(folder);
    const name = cargo.package.name.replace(/-/g, '_');
    return {
      programId: cargo.package.metadata.solana['program-id'],
      deployPath: path.join(binaryDir, `${name}.so`),
    };
  });
}

function getExternalPrograms() {
  const binaryDir = getExternalProgramOutputDir();
  return getExternalProgramAddresses().map((address) => ({
    programId: address,
    deployPath: path.join(binaryDir, `${address}.so`),
  }));
}

function getExternalAccounts() {
  const binaryDir = getExternalProgramOutputDir();
  return getExternalAccountAddresses().map((address) => ({
    account: address,
    deployPath: path.join(binaryDir, `${address}.json`),
  }));
}
