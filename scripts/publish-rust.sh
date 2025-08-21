#!/usr/bin/env bash

set -euo pipefail

library_path="${1:-}"
level="${2:-}"
dry_run="${DRY_RUN:-false}"

if [[ -z "$library_path" || -z "$level" ]]; then
    echo "Usage: $0 <library_path> <version-level>"
    echo "Example: $0 clients/rust patch"
    exit 1
fi

cd "$library_path"
tag_name=$(basename $library_path)

metadata=$(cargo metadata --no-deps --format-version 1)
old_version=$(echo "$metadata" | jq -r '.packages[0].version')

# Run cargo-release
if [[ "$dry_run" != "true" ]]; then
  cargo release "$level" --tag-name "${tag_name}@v{{version}}" --no-confirm --execute --dependent-version fix
else
  cargo release "$level"
  exit 0
fi

# Extract version using cargo metadata
metadata=$(cargo metadata --no-deps --format-version 1)
new_version=$(echo "$metadata" | jq -r '.packages[0].version')

# CI output
if [[ -n "${CI:-}" ]]; then
  echo "new_git_tag=${tag_name}@v${new_version}" >> "$GITHUB_OUTPUT"
  echo "old_git_tag=${tag_name}@v${old_version}" >> "$GITHUB_OUTPUT"
fi
