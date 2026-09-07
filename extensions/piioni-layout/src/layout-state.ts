import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
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
export interface LayoutSnapshot {
  cwd: string;
  workspace: WorkspaceStateSnapshot;
  dashboard: {
    runtime: DashboardRuntimeSnapshot;
    extensions: DashboardExtensionsSnapshot;
  };
}

export function buildLayoutSnapshot(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  workspace: WorkspaceStateSnapshot,
  footerData?: FooterStatusProvider,
): LayoutSnapshot {
  return {
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
