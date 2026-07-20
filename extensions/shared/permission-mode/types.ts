export type PermissionState = "allow" | "ask" | "deny";

export interface PermissionPolicy {
  defaultPolicy: {
    tools: PermissionState;
    bash: PermissionState;
    mcp: PermissionState;
    skills: PermissionState;
    special: PermissionState;
  };
  tools: Record<string, PermissionState>;
  bash: Record<string, PermissionState>;
  mcp: Record<string, PermissionState>;
  skills: Record<string, PermissionState>;
  special: Record<string, PermissionState>;
}

export type PermissionModeName = "Palantír" | "Mithril Forge" | "Balrog";

export interface PermissionMode {
  name: PermissionModeName;
  policy: PermissionPolicy;
}

export interface PermissionModeRuntimeAPI {
  getMode(): PermissionModeName;
  getModes(): readonly PermissionModeName[];
  setMode(mode: PermissionModeName, options?: { notify?: boolean }): { mode?: PermissionModeName; error?: string };
  cycle(options?: { notify?: boolean }): { mode: PermissionModeName; error?: string };
  subscribe(listener: (mode: PermissionModeName) => void): () => void;
}

declare global {
  // eslint-disable-next-line no-var
  var __piioniPermissionMode: PermissionModeRuntimeAPI | undefined;
}

export {};
