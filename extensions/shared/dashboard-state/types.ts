export type DashboardStatusTone = "success" | "warning" | "error" | "accent" | "dim";

export interface DashboardStatusPart {
  text: string;
  tone: DashboardStatusTone;
}

export interface DashboardUsageSnapshot {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
}

export interface DashboardContextSnapshot {
  percent?: number;
  tokens?: number;
  contextWindow?: number;
}

export interface DashboardRuntimeSnapshot {
  modelId: string;
  providerId: string;
  thinkingLevel: string;
  usage: DashboardUsageSnapshot;
  context: DashboardContextSnapshot;
  usageSummary: string;
}

export interface DashboardExtensionsSnapshot {
  parts: DashboardStatusPart[];
}
