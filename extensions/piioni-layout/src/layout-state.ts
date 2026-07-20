import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  buildDashboardExtensionsSnapshot,
  type FooterStatusProvider,
} from "../../shared/dashboard-state/footer";
import { buildDashboardRuntimeSnapshot } from "../../shared/dashboard-state/runtime";
import type {
  DashboardExtensionsSnapshot,
  DashboardRuntimeSnapshot,
} from "../../shared/dashboard-state/types";
import type { WorkspaceStateSnapshot } from "../../shared/workspace-state/types";
import { getInitialPermissionMode, getPermissionModeAPI } from "./permission-mode";
import type { PermissionMode } from "./types";

export const LAYOUT_STATE_CUSTOM_TYPE = "piioni-layout-state";

interface PersistedLayoutState {
  mode?: PermissionMode;
}

export interface LayoutSnapshot {
  mode: PermissionMode;
  cwd: string;
  workspace: WorkspaceStateSnapshot;
  dashboard: {
    runtime: DashboardRuntimeSnapshot;
    extensions: DashboardExtensionsSnapshot;
  };
}

function normalizePermissionMode(value: unknown): PermissionMode | undefined {
  return value === "Palantír" || value === "Mithril Forge" || value === "Balrog"
    ? value
    : undefined;
}

function getLastSessionMode(ctx: ExtensionContext): PermissionMode | undefined {
  try {
    const entries = ctx.sessionManager.getBranch();
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index] as {
        type?: string;
        customType?: string;
        data?: { mode?: unknown };
      };
      if (entry.type !== "custom" || entry.customType !== LAYOUT_STATE_CUSTOM_TYPE) continue;
      const mode = normalizePermissionMode(entry.data?.mode);
      if (mode) return mode;
    }
  } catch {
    // Session history is best-effort; fall back to global/runtime state.
  }

  return undefined;
}

export function appendLayoutState(pi: ExtensionAPI, mode: PermissionMode): void {
  try {
    pi.appendEntry<PersistedLayoutState>(LAYOUT_STATE_CUSTOM_TYPE, { mode });
  } catch {
    // Layout state should never break the main Pi session.
  }
}

export function resolveInitialMode(ctx: ExtensionContext): PermissionMode {
  return getPermissionModeAPI()?.getMode() ?? getLastSessionMode(ctx) ?? getInitialPermissionMode();
}

export function buildLayoutSnapshot(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  mode: PermissionMode,
  workspace: WorkspaceStateSnapshot,
  footerData?: FooterStatusProvider,
): LayoutSnapshot {
  return {
    mode,
    cwd: ctx.cwd,
    workspace,
    dashboard: {
      runtime: buildDashboardRuntimeSnapshot(ctx, pi),
      extensions: footerData
        ? buildDashboardExtensionsSnapshot(footerData)
        : { parts: [] },
    },
  };
}
