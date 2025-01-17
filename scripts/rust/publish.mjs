#!/usr/bin/env zx
import 'zx/globals';
import { cliArguments, getCargo, workingDirectory } from '../utils.mjs';

const dryRun = argv['dry-run'] ?? false;
const [folder, level] = cliArguments();
if (!folder) {
  throw new Error('A path to a directory with a Rust package — e.g. "clients/cli" — must be provided.');
}
if (!level) {
  throw new Error('A version level — e.g. "patch" — must be provided.');
}

cd(path.join(workingDirectory, folder));

const packageToml = getCargo(folder).package;
const oldVersion = packageToml.version;
const packageName = packageToml.name;
const tagName = path.basename(folder);

// Publish the new version, commit the repo change, tag it, and push it all.
const releaseArgs = dryRun
  ? []
  : ['--tag-name', `${tagName}@v{{version}}`, '--no-confirm', '--execute'];
await $`cargo release ${level} ${releaseArgs}`;

// Stop here if this is a dry run.
if (dryRun) {
  process.exit(0);
}

// Get the new version.
const newVersion = getCargo(folder).package.version;
const newGitTag = `${tagName}@v${newVersion}`;
const oldGitTag = `${tagName}@v${oldVersion}`;

// Expose the new version to CI if needed.
if (process.env.CI) {
  await $`echo "new_git_tag=${newGitTag}" >> $GITHUB_OUTPUT`;
  await $`echo "old_git_tag=${oldGitTag}" >> $GITHUB_OUTPUT`;
}
