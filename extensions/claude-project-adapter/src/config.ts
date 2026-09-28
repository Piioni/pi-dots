export const MAX_RULE_BYTES = 120_000;
export const MAX_COMMAND_BYTES = 120_000;
export const MAX_SETTINGS_BYTES = 256_000;
export const DEFAULT_HOOK_TIMEOUT_SECONDS = 10;
export const MAX_HOOK_TIMEOUT_SECONDS = 60;
export const MAX_PRE_TOOL_USE_HOOKS = 16;
export const MAX_HOOK_BATCH_TIMEOUT_MS = 60_000;
export const MAX_HOOK_OUTPUT_BYTES = 64 * 1024;
export const HOOK_KILL_GRACE_MS = 1_000;

export type PiToolName = "bash" | "edit" | "find" | "grep" | "ls" | "read" | "write";

export const PI_TOOL_NAMES = new Set<string>(["bash", "edit", "find", "grep", "ls", "read", "write"]);

export const RESERVED_PI_COMMAND_NAMES = new Set<string>([
  "changelog",
  "clone",
  "compact",
  "copy",
  "export",
  "fork",
  "hotkeys",
  "import",
  "login",
  "logout",
  "model",
  "name",
  "new",
  "quit",
  "reload",
  "resume",
  "scoped-models",
  "session",
  "settings",
  "share",
  "tree",
  "trust",
]);

export const ALLOWED_CLAUDE_COMMAND_NAMES = new Set<string>([
  "adr",
  "branch",
  "changelog",
  "check",
  "commit-changelog",
  "create-feature-scaffold",
  "gen",
  "new-usecase",
  "pr",
  "test-for",
]);
