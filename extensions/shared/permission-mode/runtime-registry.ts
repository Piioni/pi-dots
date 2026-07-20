import type { PermissionModeRuntimeAPI } from "./types";

export function getPermissionModeRuntime(): PermissionModeRuntimeAPI | undefined {
  return globalThis.__piioniPermissionMode;
}

export function registerPermissionModeRuntime(api: PermissionModeRuntimeAPI): void {
  globalThis.__piioniPermissionMode = api;
}
