import { PERMISSION_MODE_NAMES } from "../../shared/permission-mode/modes";
import { readPermissionModeNameFromState } from "../../shared/permission-mode/state-file";
import type { PermissionMode } from "./types";

export function getInitialPermissionMode(): PermissionMode {
  return readPermissionModeNameFromState(PERMISSION_MODE_NAMES[0]);
}
