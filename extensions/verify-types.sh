#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

for package in \
  claude-project-adapter \
  moshi-permission-bridge
 do
  package_dir="$ROOT_DIR/$package"
  typecheck="$package_dir/node_modules/.bin/tsc"
  if [[ ! -x "$typecheck" ]]; then
    printf 'Missing local TypeScript compiler for %s\n' "$package" >&2
    exit 1
  fi

  printf 'Typechecking %s\n' "$package"
  "$typecheck" --noEmit -p "$package_dir/tsconfig.json"
done
