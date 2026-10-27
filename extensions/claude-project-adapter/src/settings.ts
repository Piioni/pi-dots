import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MAX_SETTINGS_BYTES } from "./config.ts";

export type ClaudeSettings = Record<string, SettingsValue>;
type SettingsObject = { [key: string]: SettingsValue };
type SettingsValue = null | boolean | number | string | SettingsValue[] | SettingsObject;
export type ClaudeSettingsResult = { settings: ClaudeSettings; diagnostics: string[] };

const supportedEvents = new Set(["PreToolUse", "SessionStart", "Stop"]);
const knownEvents = new Set([
  "PreToolUse", "PostToolUse", "PostToolUseFailure", "Notification", "UserPromptSubmit",
  "SessionStart", "SessionEnd", "Stop", "SubagentStart", "SubagentStop", "PreCompact",
  "PermissionRequest", "Setup", "TeammateIdle", "TaskCompleted", "ConfigChange",
  "WorktreeCreate", "WorktreeRemove",
]);
const knownHookTypes = new Set(["command", "prompt", "agent"]);
const knownUnsupportedSettings = new Set([
  "model", "fallbackModel", "modelPicker", "modelSettings", "availableModels", "env", "enabledPlugins",
  "extraKnownMarketplaces", "statusLine", "outputStyle", "plansDirectory", "cleanupPeriodDays",
  "language", "sandbox", "attribution",
]);
const MAX_DIAGNOSTIC_BYTES = 256;
const MAX_DIAGNOSTICS = 20;
const MAX_DIAGNOSTIC_OUTPUT_BYTES = 4_096;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson(value: unknown): SettingsValue {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (isRecord(value)) {
    const safe = Object.create(null) as SettingsObject;
    for (const [key, child] of Object.entries(value)) {
      Object.defineProperty(safe, key, {
        value: cloneJson(child),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return safe;
  }
  if (value === null || ["boolean", "number", "string"].includes(typeof value)) {
    return value as string | number | boolean | null;
  }
  throw new TypeError("invalid settings value");
}

function safeDiagnostic(message: string): string {
  let result = "";
  for (const character of message.replace(/[\x00-\x1f\x7f-\x9f]/g, " ")) {
    if (Buffer.byteLength(result + character) > MAX_DIAGNOSTIC_BYTES) break;
    result += character;
  }
  return result;
}

function boundedDiagnostics(messages: string[]): string[] {
  const unique = [...new Set(messages.map(safeDiagnostic))];
  const result: string[] = [];
  let bytes = 0;
  let omitted = 0;
  for (const message of unique) {
    const size = Buffer.byteLength(message);
    if (
      result.length >= MAX_DIAGNOSTICS - 1 ||
      bytes + size > MAX_DIAGNOSTIC_OUTPUT_BYTES - MAX_DIAGNOSTIC_BYTES
    ) {
      omitted++;
      continue;
    }
    result.push(message);
    bytes += size;
  }
  if (omitted > 0) result.push(`${omitted} additional settings diagnostics suppressed.`);
  return result;
}

function readSettingsFile(path: string): { settings: ClaudeSettings; diagnostics: string[] } {
  const name = path.split(/[\\/]/).pop();
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return { settings: Object.create(null), diagnostics: [`${name} is not a regular file; ignored.`] };
    if (stat.size > MAX_SETTINGS_BYTES) {
      return { settings: Object.create(null), diagnostics: [`${name} exceeds the settings size limit; ignored.`] };
    }
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(parsed)) {
      return { settings: Object.create(null), diagnostics: [`${name} does not contain a settings object; ignored.`] };
    }
    return { settings: cloneJson(parsed) as ClaudeSettings, diagnostics: [] };
  } catch (error) {
    const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
    if (code === "ENOENT") return { settings: Object.create(null), diagnostics: [] };
    const detail = error instanceof SyntaxError ? "invalid JSON" : "unreadable";
    return { settings: Object.create(null), diagnostics: [`${name} is ${detail}; ignored.`] };
  }
}

function diagnoseSettings(settings: ClaudeSettings): string[] {
  const diagnostics: string[] = [];
  let suppressed = false;
  const add = (message: string) => {
    const safe = safeDiagnostic(message);
    if (diagnostics.includes(safe)) return;
    if (diagnostics.length < MAX_DIAGNOSTICS - 1) diagnostics.push(safe);
    else suppressed = true;
  };

  let hasUnknownSetting = false;
  for (const key of Object.keys(settings)) {
    if (key === "hooks" || key === "permissions") continue;
    if (knownUnsupportedSettings.has(key)) add(`Claude setting '${key}' is unsupported and was ignored.`);
    else hasUnknownSetting = true;
  }
  if (hasUnknownSetting) add("One or more unknown Claude settings are unsupported and were ignored.");

  const permissions = Object.hasOwn(settings, "permissions") ? settings.permissions : undefined;
  if (permissions !== undefined && !isRecord(permissions)) {
    add("Claude permissions settings are invalid and were ignored.");
  } else if (isRecord(permissions)) {
    if (Object.keys(permissions).some((key) => key !== "additionalDirectories")) {
      add("Other Claude permission settings are unsupported and were ignored.");
    }
  }

  const hooks = Object.hasOwn(settings, "hooks") ? settings.hooks : undefined;
  if (hooks !== undefined && !isRecord(hooks)) {
    add("Claude hooks settings are invalid and were ignored.");
    if (suppressed) diagnostics.push("Additional settings diagnostics suppressed.");
    return diagnostics;
  }
  if (isRecord(hooks)) {
    let hasUnknownEvent = false;
    for (const [event, value] of Object.entries(hooks)) {
      if (!knownEvents.has(event)) {
        hasUnknownEvent = true;
        continue;
      }
      if (!supportedEvents.has(event)) {
        add(`Claude hook event '${event}' is not supported yet and was not run.`);
        continue;
      }
      if (!Array.isArray(value)) {
        add(`Claude ${event} hook configuration is invalid and was ignored.`);
        continue;
      }
      for (const entry of value) {
        if (!isRecord(entry) || !Object.hasOwn(entry, "hooks") || !Array.isArray(entry.hooks)) {
          add(`Claude ${event} hook entry is invalid and was ignored.`);
          continue;
        }
        for (const hook of entry.hooks) {
          const type = isRecord(hook) && Object.hasOwn(hook, "type") ? hook.type : undefined;
          if (type === "command") {
            const command = Object.hasOwn(hook as Record<string, unknown>, "command")
              ? (hook as Record<string, unknown>).command
              : undefined;
            if (typeof command !== "string") add("Claude command hook is missing a command and was ignored.");
          } else if (typeof type === "string" && knownHookTypes.has(type)) {
            add(`Claude hook type '${type}' is not supported yet; only command hooks run for PreToolUse, SessionStart, and Stop.`);
          } else {
            add(`Claude ${event} hook has an unsupported type and was not run.`);
          }
        }
      }
    }
    if (hasUnknownEvent) add("One or more unknown Claude hook events are unsupported and were not run.");
  }
  if (suppressed) diagnostics.push("Additional settings diagnostics suppressed.");
  return diagnostics;
}

/** Special list/model settings remain unsupported and are diagnosed rather than interpreted. */
export function loadClaudeSettings(claudeDir: string): ClaudeSettingsResult {
  const shared = readSettingsFile(join(claudeDir, "settings.json"));
  return {
    settings: shared.settings,
    diagnostics: boundedDiagnostics([
      ...shared.diagnostics,
      ...diagnoseSettings(shared.settings),
    ]),
  };
}
