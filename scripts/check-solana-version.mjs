#!/usr/bin/env zx
import 'zx/globals';
import { getInstalledSolanaVersion, getSolanaVersion } from './utils.mjs';

const expectedVersion = getSolanaVersion();
const installedVersion = await getInstalledSolanaVersion();

if (installedVersion !== expectedVersion) {
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
