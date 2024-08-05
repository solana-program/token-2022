#!/usr/bin/env zx
import 'zx/globals';
import { getInstalledSolanaVersion, getSolanaVersion } from './utils.mjs';

const expectedVersion = getSolanaVersion();
const installedVersion = await getInstalledSolanaVersion();

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

if (!installedVersion) {
  echo(
    chalk.red('[ ERROR ]'),
    `No Solana installation found. Solana ${expectedVersion} is required for this project.`
  );
  await askToInstallSolana(expectedVersion);
} else if (installedVersion === expectedVersion) {
  echo(
    chalk.green('[ SUCCESS ]'),
    `The expected Solana version ${expectedVersion} is installed.`
  );
} else if (hasRelease) {
  await $`rm -f "${activeReleasePath}"`;
  await $`ln -s "${releasePath}" "${activeReleasePath}"`;
  echo(
    chalk.green('[ SUCCESS ]'),
    `Successfully switched from Solana version ${installedVersion} to ${expectedVersion} to match the project's requirements.`
  );
} else {
  echo(
    chalk.yellow('[ WARNING ]'),
    `Cannot switch from Solana version ${installedVersion} to ${expectedVersion} because it is not installed.`
  );
  await askToInstallSolana(expectedVersion);
}

async function askToInstallSolana(version) {
  const installRelease = await question('Should we install it now? [y/N] ');
  if (installRelease === 'y') {
    await installSolana(version);
    echo(
      chalk.green('[ SUCCESS ]'),
      `Successfully installed Solana version ${version}.`
    );
  } else {
    process.exit(1);
  }
}

async function installSolana(version) {
  echo(`Installing Solana ${version}...`);
  const cutoff = '1.18.19';
  const isBeforeCutoff =
    (await $`[[ "$(printf '%s\n' "${cutoff}" "${version}" | sort -V | head -n1)" = "${version}" ]] && [[ "${cutoff}" != "${version}" ]]`.quiet()
      .exitCode) == 0;
  if (isBeforeCutoff) {
    await $`sh -c "$(curl -sSfL https://release.solana.com/v${version}/install)"`;
  } else {
    await $`sh -c "$(curl -sSfL https://release.anza.xyz/v${version}/install)"`;
  }
}
