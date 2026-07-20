import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  AGENT_DIR,
  STATE_PATH,
  readPermissionModeNameFromState,
} from "../../shared/permission-mode/state-file";
import { MODES, getMode } from "./policies";
import type { PermissionMode, PermissionModeName } from "./types";

export const POLICY_PATH = join(AGENT_DIR, "pi-permissions.jsonc");
export const BACKUP_PATH = join(AGENT_DIR, "pi-permissions.manual-backup.jsonc");

export function readCurrentModeName(): PermissionModeName {
  return readPermissionModeNameFromState(MODES[0].name);
}

export function writeCurrentMode(mode: PermissionMode): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify({ mode: mode.name }, null, 2)}\n`, "utf8");
}

function isGeneratedPolicyContent(content: string): boolean {
  const trimmed = content.trim();
  return MODES.some((mode) => trimmed === JSON.stringify(mode.policy, null, 2));
}

export function backupExistingPolicyIfNeeded(): void {
  if (!existsSync(POLICY_PATH) || existsSync(BACKUP_PATH)) return;
  if (isGeneratedPolicyContent(readFileSync(POLICY_PATH, "utf8"))) return;

  writeFileSync(BACKUP_PATH, readFileSync(POLICY_PATH, "utf8"), "utf8");
}

export function writePolicy(mode: PermissionMode): void {
  mkdirSync(dirname(POLICY_PATH), { recursive: true });
  backupExistingPolicyIfNeeded();
  writeFileSync(POLICY_PATH, `${JSON.stringify(mode.policy, null, 2)}\n`, "utf8");
}

export function readCurrentMode(): PermissionMode {
  return getMode(readCurrentModeName());
}
