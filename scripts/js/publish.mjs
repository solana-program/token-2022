#!/usr/bin/env zx
import 'zx/globals';
import { cliArguments, getPackageJson, workingDirectory } from '../utils.mjs';

const [folder, level, tag = 'latest'] = cliArguments();
if (!folder) {
  throw new Error('A path to a directory with a JS package — e.g. "clients/js" — must be provided.');
}
if (!level) {
  throw new Error('A version level — e.g. "patch" — must be provided.');
}

// Go to the client directory and install the dependencies.
cd(path.join(workingDirectory, folder));
await $`pnpm install`;

const tagName = path.basename(folder);
const packageJson = getPackageJson(folder);
const oldVersion = packageJson.version;
const oldGitTag = `${tagName}@v${oldVersion}`;

// Update the version.
const versionArgs = [
  '--no-git-tag-version',
  ...(level.startsWith('pre') ? [`--preid ${tag}`] : []),
];
let { stdout } = await $`pnpm version ${level} ${versionArgs}`;
const newVersion = stdout.slice(1).trim();
const newGitTag = `${tagName}@v${newVersion}`;

// Expose the new version to CI if needed.
if (process.env.CI) {
  await $`echo "new_git_tag=${newGitTag}" >> $GITHUB_OUTPUT`;
  await $`echo "old_git_tag=${oldGitTag}" >> $GITHUB_OUTPUT`;
}

// Publish the package.
// This will also build the package before publishing (see prepublishOnly script).
await $`pnpm publish --no-git-checks --tag ${tag}`;

// Commit the new version.
await $`git commit -am "Publish ${tagName} v${newVersion}"`;

// Tag the new version.
await $`git tag -a ${newGitTag} -m "${tagName} v${newVersion}"`;
