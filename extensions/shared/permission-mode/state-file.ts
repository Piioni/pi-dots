import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isPermissionModeName, PERMISSION_MODE_NAMES } from "./modes";
import type { PermissionModeName } from "./types";

export const AGENT_DIR = join(homedir(), ".pi", "agent");
export const STATE_PATH = join(AGENT_DIR, "permission-mode-state.json");

export function readPermissionModeNameFromState(
  fallback: PermissionModeName = PERMISSION_MODE_NAMES[0],
): PermissionModeName {
  try {
    const parsed = JSON.parse(readFileSync(STATE_PATH, "utf8")) as { mode?: unknown };
    if (isPermissionModeName(parsed.mode)) return parsed.mode;
  } catch {
    // Missing or invalid state falls back to the provided default.
  }

  return fallback;
}
