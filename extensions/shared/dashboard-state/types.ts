export type DashboardStatusTone = "success" | "warning" | "error" | "accent" | "dim";

export interface DashboardStatusPart {
  text: string;
  tone: DashboardStatusTone;
}

export interface DashboardUsageSnapshot {
  input?: number;
  output?: number;
  cacheRead?: number;
}

export interface DashboardContextSnapshot {
  percent?: number;
  tokens?: number;
  contextWindow?: number;
}

export interface DashboardRuntimeSnapshot {
  modelId: string;
  thinkingLevel: string;
  usage: DashboardUsageSnapshot;
  context: DashboardContextSnapshot;
}

export interface DashboardExtensionsSnapshot {
  parts: DashboardStatusPart[];
}

export type DashboardMcpState = "healthy" | "partial" | "failed" | "off";

export interface DashboardMcpStatus {
  state: DashboardMcpState;
  connected: number;
  total: number;
}

export type DashboardLspState = "healthy" | "partial" | "failed" | "off";

export interface DashboardLspStatus {
  state: DashboardLspState;
  active: string[];
  failed: string[];
}
