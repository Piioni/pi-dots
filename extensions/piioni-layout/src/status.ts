import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DashboardExtensionsSnapshot, DashboardStatusPart } from "../../shared/dashboard-state/types";
import { colorDim, colorStatus } from "./colors";

function renderPart(ctx: ExtensionContext, part: DashboardStatusPart): string {
  return colorStatus(ctx, part.tone, part.text);
}

export function buildExtensionStatusFromSnapshot(
  ctx: ExtensionContext,
  snapshot: DashboardExtensionsSnapshot,
): string {
  return snapshot.parts.map((part) => renderPart(ctx, part)).join(colorDim(ctx, " • "));
}
