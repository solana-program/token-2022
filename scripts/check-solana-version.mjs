#!/usr/bin/env zx
import 'zx/globals';
import { getInstalledSolanaVersion, getSolanaVersion } from './utils.mjs';

const expectedVersion = getSolanaVersion();
const installedVersion = await getInstalledSolanaVersion();

if (!installedVersion) {
  echo(
    chalk.red('[ ERROR ]'),
    `No Solana installation found. Please install Solana ${expectedVersion} before proceeding.`
  );
  process.exit(1);
} else if (installedVersion !== expectedVersion) {
  echo(
    chalk.yellow('[ WARNING ]'),
    `The installed Solana version ${installedVersion} does not match the expected version ${expectedVersion}.`
  );
} else {
  echo(
    chalk.green('[ SUCCESS ]'),
    `The expected Solana version ${expectedVersion} is installed.`
  );
}
