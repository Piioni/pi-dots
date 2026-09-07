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

export type PermissionModeName = "default";

export interface PermissionMode {
  name: PermissionModeName;
  policy: PermissionPolicy;
}
