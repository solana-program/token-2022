#!/usr/bin/env zx
import 'zx/globals';

const isValidatorRunning = (await $`lsof -t -i:8899`.quiet().exitCode) === 0;

if (isValidatorRunning) {
  // Kill the validator if it's already running.
  await $`pkill -f solana-test-validator`.quiet();
  await sleep(1000);
  echo(chalk.green('Local validator terminated!'));
} else {
  echo(chalk.yellow('Local validator is not running.'));
}
