# Gotgenes 41.0.0 cutover and rollback (T3 proposal)

No global cutover was performed. `candidate/config.json` is the sole deployable unified config; `candidate/pi-permissions.jsonc` is a comment-only migration reminder because the package does **not** load that legacy filename.

## Policy behavior to review

The candidate retains the host's broad `permission["*"] = "allow"` fallback for non-Linear MCP servers and other unspecified surfaces; Linear defaults to `ask`, with `get_*`, `list_*`, documentation search, and image extraction explicitly allowed. Synthetic probes observed Linear label reads and `engram:mem_search` allowed and representative Linear mutations asked. Trusted project/agent configs compose above the global rules and may override matching entries; this probe used an empty trusted project config, so project-specific overrides were not exercised. External-directory checks allow an ordinary synthetic path but deny the listed sensitive locations. All ten risky Bash rules retain `ask` for both argument-bearing and argument-free inputs. The legacy extension also reports `ask` through its decision manager; a blocked hook result in this no-UI fixture only means approval was rejected, not that policy denied the command.

## Cutover — parent-owned T4 only

1. Confirm both backup integrity and unchanged active files before changing anything:
   ```sh
   cd /home/piioni/.pi/agent/odd/gotgenes-permissions/backups
   sha256sum -c SHA256SUMS
   cmp -s ../../../settings.json settings.json && cmp -s ../../../pi-permissions.jsonc pi-permissions.jsonc && cmp -s ../../../extensions/pi-permission-system/config.json config.json
   ```
   Stop if either command fails. Preserve the pre-existing `lastChangelogVersion: 1.4.0`; do not replace unrelated settings. Keep the clone and mode-600 backups.
2. Install only the pinned package: `pi install npm:@gotgenes/pi-permission-system@41.0.0`.
3. Replace `extensions/pi-permission-system/config.json` with `candidate/config.json`; register the pinned package once. Remove the explicit clone path from `settings.json` **and** add `"-extensions/pi-permission-system/index.ts"` to its `extensions` list. This documented exclusion prevents Pi's automatic `<agent-dir>/extensions/` discovery from loading the retained clone; the isolated Pi loader probe confirmed only Gotgenes loaded and registered one `/permission-system` command. Preserve unrelated settings.
4. Move `pi-permissions.jsonc` aside to a unique backup name (do not overwrite an existing destination); the policy has been translated into the unified config. This avoids the package's legacy-policy warning and leaves the file recoverable.
5. Run `pi list`, inspect registration uniqueness, then start an isolated/reviewed Pi session and rerun the acceptance probe. Do not approve destructive or remote operations. Restart Pi after package/settings changes; `/reload` alone does not install a package or change global settings.

## Rollback

1. `pi remove npm:@gotgenes/pi-permission-system@41.0.0`.
2. Restore the original `settings.json`, `pi-permissions.jsonc`, and extension `config.json` from the three retained backups. Restore the original clone path in `settings.json`; preserve other settings that changed independently (especially `lastChangelogVersion`) rather than overwriting newer state blindly.
3. Restore the moved policy file to `pi-permissions.jsonc` only after confirming the destination is absent. Restart Pi and confirm the clone is the sole active permission extension.

Backups and `SHA256SUMS` are ignored sandbox data with mode 600, not commit artifacts. `candidate/config.json` is the only policy authority; `candidate/pi-permissions.jsonc` is intentionally comment-only. Reviewable artifacts are `candidate/`, `acceptance/`, and this procedure.
