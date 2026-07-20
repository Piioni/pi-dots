import type { PermissionModeName } from "./types";

export const PERMISSION_MODE_NAMES = ["Palantír", "Mithril Forge", "Balrog"] as const satisfies readonly PermissionModeName[];

export function isPermissionModeName(value: unknown): value is PermissionModeName {
  return typeof value === "string" && PERMISSION_MODE_NAMES.includes(value as PermissionModeName);
}
