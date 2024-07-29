#!/usr/bin/env zx
import 'zx/globals';
import { getInstalledSolanaVersion, getSolanaVersion } from './utils.mjs';

const installedVersion = await getInstalledSolanaVersion();
const expectedVersion = getSolanaVersion();

if (installedVersion === expectedVersion) {
  echo(
    chalk.green('[ SUCCESS ]'),
    `The expected Solana version ${expectedVersion} is installed.`
  );
  process.exit(0);
}

const installPath = path.join(
  os.homedir(),
  '.local',
  'share',
  'solana',
  'install'
);
const releasePath = path.join(
  installPath,
  'releases',
  expectedVersion,
  'solana-release'
);
const activeReleasePath = path.join(installPath, 'active_release');
const hasRelease = await fs.exists(releasePath);

if (hasRelease) {
  await $`rm -f "${activeReleasePath}"`;
  await $`ln -s "${releasePath}" "${activeReleasePath}"`;
  echo(
    chalk.green('[ SUCCESS ]'),
    `Successfully switched from Solana version ${installedVersion} to ${expectedVersion} to match the project's requirements.`
  );
  process.exit(0);
}

echo(
  chalk.yellow('[ WARNING ]'),
  `Cannot switch from Solana version ${installedVersion} to ${expectedVersion} because it is not installed.`
);

const installRelease = await question('Should we install it now? [y/N] ');
if (installRelease === 'y') {
  echo(`Installing Solana ${expectedVersion}...`);
  await $`sh -c "$(curl -sSfL https://release.solana.com/v${expectedVersion}/install)"`;
}

echo(
  chalk.green('[ SUCCESS ]'),
  `Successfully switched from Solana version ${installedVersion} to ${expectedVersion} to match the project's requirements.`
);
