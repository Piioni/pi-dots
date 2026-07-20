export interface RenderableTui {
  requestRender(): void;
}

export interface WidgetComponent {
  dispose(): void;
  invalidate(): void;
  render(width: number): string[];
}

export type { PermissionModeName as PermissionMode, PermissionModeRuntimeAPI } from "../../shared/permission-mode/types";
