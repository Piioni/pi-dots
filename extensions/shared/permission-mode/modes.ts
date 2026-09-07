import type { PermissionModeName } from "./types";

export const PERMISSION_MODE_NAMES = ["default"] as const satisfies readonly PermissionModeName[];

export function isPermissionModeName(value: unknown): value is PermissionModeName {
  return value === PERMISSION_MODE_NAMES[0];
}
