import { PERMISSION_MODE_NAMES } from "../../shared/permission-mode/modes";
import { getPermissionModeRuntime } from "../../shared/permission-mode/runtime-registry";
import { readPermissionModeNameFromState } from "../../shared/permission-mode/state-file";
import type { PermissionMode, PermissionModeRuntimeAPI } from "./types";

export function getPermissionModeAPI(): PermissionModeRuntimeAPI | undefined {
  return getPermissionModeRuntime();
}

export function getInitialPermissionMode(): PermissionMode {
  return (
    getPermissionModeAPI()?.getMode() ??
    readPermissionModeNameFromState(PERMISSION_MODE_NAMES[0])
  );
}
