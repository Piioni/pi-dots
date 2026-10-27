# Gotgenes 41.0.0 cutover and rollback

## Current state after successful resume

The parent no-network resume completed successfully (exit 0). Gotgenes `41.0.0` is installed, registered exactly once in `settings.json`, and pinned exactly in the managed npm manifest and lock. `extensions/pi-permission-system/` now contains the verified unified `config.json`, not clone source. The full clone, its original config and the legacy root policy are retained at ignored `disabled-extensions/pi-permission-system/`; all 50 tracked-file hashes and symlink metadata were verified after the move. The archive and transaction/backups are intentionally local recovery data, not committed resources.

All five installed-package smoke probes passed after cutover: real Pi loader uniqueness, permission decisions and scope composition/YOLO, legacy comparison, parent forwarding approval/denial/cancel/timeout, and host codemode interception. The current already-running Pi process may still hold the old extension in memory; restart Pi after delivery to use the new registration. No real destructive command, remote Linear mutation or external project access was exercised.

Comparative npm audits before and after installation reported the same two pre-existing high-severity vulnerable packages (`body-parser`, `undici`), with no new advisories from this migration. No `npm audit fix` or unrelated dependency update was run. Separate Claude/Sipos integration and warning work is excluded from this migration and its commits.

## First attempt (retained history)

The first parent-run cutover successfully installed `npm:@gotgenes/pi-permission-system@41.0.0` (six packages; `pi list` showed the exact source), then startup smoke failed with `ENOENT` for `extensions/pi-permission-system/index.ts`: the probe still assumed the clone remained at its old active path. The parent transaction rolled back. Parent checks confirmed the original settings, root policy and clone config; all 50 tracked clone hashes; the clone entry point; and the absent archive destination. The installed package remains under `npm/node_modules/@gotgenes/pi-permission-system`, but it is unregistered. Do not rerun `pi install`.

The failed attempt's `pre-cutover/transaction/`, `pre-cutover/cutover.log`, initial snapshots, and audit reports are retained evidence. The npm install changed the managed root manifest and lock to `^41.0.0` while the resolved package is `41.0.0`; no dependency re-resolution is needed. The install output reported two high-severity advisories. Parent baseline/current audit reports are separate evidence; do not overwrite them or run `npm audit fix`.

The candidate remains `candidate/config.json` (verified in commit `128929055de07642dc4a028db0470c9df6b1ffd5`). It keeps the broad allow fallback, all ten Bash asks (bare and argument-bearing), the sudo/sensitive-path denials, and the agreed Linear policy. Do not change the candidate. Claude/Sipos integration and warning changes are separate concurrent work and are excluded here; preserve all adapter/Sipos edits.

## Retry probe behavior

`acceptance/startup-probe.mjs` now selects only a complete clone (`index.ts` and `src/index.ts`) from active extensions first or the disabled archive second. It exercises both source layouts with synthetic fixtures, uses the real clone source selected from the workspace, and gives the config-only Gotgenes fixture the verified candidate config. This fixes the exact path failure in the first cutover log. The legacy differential already falls back to the archive; the other probes use the configurable package root and do not read the clone source.

## Parent-run resume transaction

After the parent finishes its read-only npm baseline/current audits, run this command in the background:

```sh
bash /home/piioni/.pi/agent/odd/gotgenes-permissions/pre-cutover/resume-cutover.sh
```

This retry does not contact the network, run `pi install`, remove the package, or touch `transaction/`, `cutover.log`, or `audit-*` reports. It refuses an existing `pre-cutover/transaction-2/`, validates the original settings/policy/config snapshots and clone hashes/diff/symlink metadata, checks free ignored archive paths, and asserts the already installed package is exactly 41.0.0. It snapshots the *current post-install* npm metadata under `transaction-2/` without changing the original pre-install backups.

The script surgically changes only the Gotgenes root dependency spec strings in `npm/package.json` and `npm/package-lock.json` from `^41.0.0` to `41.0.0`. Before writing, it asserts both current specs, the lock's resolved package version and installed package version are 41.0.0; it verifies the parsed manifests differ only in those two spec values. It does not resolve/install dependencies or alter integrity/resolved entries. It also atomically registers the existing pinned package in `settings.json` and removes exactly the restored clone registration, preserving all other settings. These root npm changes are performed only when the parent runs the script; the worker does not edit them.

Then it creates/uses ignored `disabled-extensions/`, renames the complete clone tree to `disabled-extensions/pi-permission-system/`, moves root `pi-permissions.jsonc` inside that tree if the destination is free, creates config-only `extensions/pi-permission-system/`, and writes the candidate config. It verifies unique package registration, no clone registration, exact candidate config, original clone hashes at the archived relative paths, and unchanged symlink metadata. It runs `pi list` and the five installed-package probes, each with a 30-second timeout.

Any post-snapshot failure invokes guarded rollback: preserve candidate files as transaction-2 evidence, restore root policy only if its destination is free, restore the complete clone only if the active destination is absent, and restore settings/npm metadata only when current files still match the transaction's captured expected state. Conflicting/newer files are preserved and reported. The package files and both attempts' evidence remain installed; there is no arbitrary deletion or `pi remove`.

## Manual restoration order if guarded rollback reports a conflict

1. Leave `transaction/`, `transaction-2/`, `cutover.log`, audit reports, and package files untouched.
2. Move the candidate config into `transaction-2/` only if it matches the verified candidate; remove the active directory only if empty.
3. Move archived `pi-permissions.jsonc` to root only if the root destination is absent.
4. Rename the whole archive back to `extensions/pi-permission-system/` only if that destination is absent. This preserves all 50 tracked clone files, the dirty `src/common.ts`, `src/index.ts`, and `tests/permission-system.test.ts`, plus untracked symlinks.
5. Restore `settings.json` only if it has no independent newer changes. Restore `npm/package.json` and `npm/package-lock.json` to the transaction-2 snapshots only if they still match the exact script-produced pinned state. Keep the installed package unregistered for inspection.
6. Restart Pi and confirm the original clone is the only active permission extension. Never modify `.gitignore` or unrelated Claude/Sipos files in this migration.

## Installed-package probes after resume

The script sets `GOTGENES_PACKAGE_ROOT=/home/piioni/.pi/agent/npm/node_modules/@gotgenes/pi-permission-system` for each probe. The standalone commands are:

```sh
env GOTGENES_PACKAGE_ROOT=/home/piioni/.pi/agent/npm/node_modules/@gotgenes/pi-permission-system timeout 30s node odd/gotgenes-permissions/acceptance/startup-probe.mjs
env GOTGENES_PACKAGE_ROOT=/home/piioni/.pi/agent/npm/node_modules/@gotgenes/pi-permission-system timeout 30s node odd/gotgenes-permissions/acceptance/probe.mjs
env GOTGENES_PACKAGE_ROOT=/home/piioni/.pi/agent/npm/node_modules/@gotgenes/pi-permission-system timeout 30s node odd/gotgenes-permissions/acceptance/legacy-differential.mjs
env GOTGENES_PACKAGE_ROOT=/home/piioni/.pi/agent/npm/node_modules/@gotgenes/pi-permission-system timeout 30s node odd/gotgenes-permissions/acceptance/forwarding-probe.mjs
env GOTGENES_PACKAGE_ROOT=/home/piioni/.pi/agent/npm/node_modules/@gotgenes/pi-permission-system timeout 30s node odd/gotgenes-permissions/acceptance/codemode-probe.mjs
```

No operation executes a real policy command, remote tool or external project access. Restart Pi after the successful settings/package registration and archive move; `/reload` does not install packages or update global package declarations.
