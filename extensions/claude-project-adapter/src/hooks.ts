import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_HOOK_TIMEOUT_SECONDS,
  HOOK_KILL_GRACE_MS,
  MAX_HOOK_BATCH_TIMEOUT_MS,
  MAX_HOOK_OUTPUT_BYTES,
  MAX_HOOK_TIMEOUT_SECONDS,
  MAX_PRE_TOOL_USE_HOOKS,
  MAX_SETTINGS_BYTES,
  PI_TOOL_NAMES,
  type PiToolName,
} from "./config";
import type { ClaudeProject, ClaudeProjectResolver } from "./project";
import { findClaudeProject, isFile, isProjectTrusted } from "./project";

type ClaudeCommandHook = {
  command: string;
  timeoutSeconds: number;
};

type ClaudePreToolUseHook = {
  matcher?: string;
  hooks: ClaudeCommandHook[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readClaudePreToolUseHooks(project: ClaudeProject): ClaudePreToolUseHook[] {
  if (!isFile(project.settingsPath)) return [];

  try {
    if (statSync(project.settingsPath).size > MAX_SETTINGS_BYTES) return [];
    const settings = JSON.parse(readFileSync(project.settingsPath, "utf8"));
    if (!isRecord(settings) || !isRecord(settings.hooks)) return [];

    const entries = settings.hooks.PreToolUse;
    if (!Array.isArray(entries)) return [];

    return entries.flatMap((entry): ClaudePreToolUseHook[] => {
      if (!isRecord(entry) || !Array.isArray(entry.hooks)) return [];

      const hooks = entry.hooks.flatMap((hook): ClaudeCommandHook[] => {
        if (!isRecord(hook) || hook.type !== "command" || typeof hook.command !== "string") return [];

        const timeoutSeconds =
          typeof hook.timeout === "number" && Number.isFinite(hook.timeout) && hook.timeout > 0
            ? Math.min(hook.timeout, MAX_HOOK_TIMEOUT_SECONDS)
            : DEFAULT_HOOK_TIMEOUT_SECONDS;

        return [{ command: hook.command, timeoutSeconds }];
      });

      if (hooks.length === 0) return [];

      return [
        {
          matcher: typeof entry.matcher === "string" ? entry.matcher : undefined,
          hooks,
        },
      ];
    });
  } catch {
    // Configuration can disappear or change while Pi is running. Skip it for this call.
    return [];
  }
}

function claudeToolAliases(toolName: PiToolName): string[] {
  switch (toolName) {
    case "bash":
      return ["bash", "Bash"];
    case "edit":
      return ["edit", "Edit", "MultiEdit"];
    case "write":
      return ["write", "Write"];
    case "read":
      return ["read", "Read"];
    case "grep":
      return ["grep", "Grep"];
    case "find":
      return ["find", "Find", "Glob"];
    case "ls":
      return ["ls", "LS", "List"];
  }
}

function matcherMatchesTool(matcher: string | undefined, toolName: PiToolName): boolean {
  if (!matcher || matcher.trim() === "" || matcher.trim() === "*") return true;

  const aliases = claudeToolAliases(toolName);
  try {
    const regex = new RegExp(`^(?:${matcher})$`);
    return aliases.some((alias) => regex.test(alias));
  } catch {
    const tokens = matcher.split(/[|,\s]+/).filter(Boolean);
    return aliases.some((alias) => tokens.includes(alias));
  }
}

function hookBlockReason(command: string, code: number | null, stdout: string, stderr: string): string {
  const output = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n").trim();
  const reason = output.length > 0 ? output : `command exited with code ${code ?? "unknown"}`;
  return `Claude PreToolUse hook blocked the tool call: ${command}\n${reason}`;
}

    function appendBounded(
      output: string,
      chunk: unknown,
      usedBytes: number,
    ): { output: string; usedBytes: number } {
      const remaining = MAX_HOOK_OUTPUT_BYTES - usedBytes;
      if (remaining <= 0) return { output, usedBytes };

      const value = Buffer.from(String(chunk));
      if (value.byteLength <= remaining) {
        return {
          output: output + value.toString("utf8"),
          usedBytes: usedBytes + value.byteLength,
        };
      }

      const marker = Buffer.from("\n[Hook output truncated]");
      if (remaining < marker.byteLength) {
        return {
          output: output + value.subarray(0, remaining).toString("utf8"),
          usedBytes: MAX_HOOK_OUTPUT_BYTES,
        };
      }

      const contentBytes = remaining - marker.byteLength;
      return {
        output:
          output +
          value.subarray(0, contentBytes).toString("utf8") +
          marker.toString("utf8"),
        usedBytes: MAX_HOOK_OUTPUT_BYTES,
      };
    }

function hookEnvironment(inputFile: string): NodeJS.ProcessEnv {
  const inherited = process.env;
  const env: NodeJS.ProcessEnv = {
    HOME: inherited.HOME,
    LANG: inherited.LANG,
    LC_ALL: inherited.LC_ALL,
    PATH: inherited.PATH,
    SHELL: inherited.SHELL,
    TERM: inherited.TERM,
    TMP: inherited.TMP,
    TEMP: inherited.TEMP,
    TMPDIR: inherited.TMPDIR,
    TOOL_INPUT_FILE: inputFile,
  };

  if (process.platform === "win32") {
    env.APPDATA = inherited.APPDATA;
    env.ComSpec = inherited.ComSpec;
    env.SystemRoot = inherited.SystemRoot;
    env.USERPROFILE = inherited.USERPROFILE;
  }

  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined));
}

function terminateProcessTree(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (!child.pid) return;

  if (process.platform === "win32") {
    try {
      const taskkill = spawn("taskkill", ["/pid", `${child.pid}`, "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      taskkill.once("error", () => child.kill(signal));
    } catch {
      child.kill(signal);
    }
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

function runCommandHook(
  project: ClaudeProject,
  hook: ClaudeCommandHook,
  payload: string,
  inputFile: string,
  timeoutMs = hook.timeoutSeconds * 1000,
): Promise<void> {
  return new Promise((resolveHook, rejectHook) => {
    const child = spawn(hook.command, {
      cwd: project.root,
      detached: process.platform !== "win32",
      env: hookEnvironment(inputFile),
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let outputBytes = 0;
    let forceKillTimeout: ReturnType<typeof setTimeout> | undefined;
    let timeout: ReturnType<typeof setTimeout>;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      // Keep the escalation timer alive after the shell closes: a detached
      // descendant may still be running after the shell receives SIGTERM.
      if (forceKillTimeout && !timedOut) clearTimeout(forceKillTimeout);
      callback();
    };

    timeout = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child, "SIGTERM");
      forceKillTimeout = setTimeout(() => terminateProcessTree(child, "SIGKILL"), HOOK_KILL_GRACE_MS);
      forceKillTimeout.unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      const bounded = appendBounded(stdout, chunk, outputBytes);
      stdout = bounded.output;
      outputBytes = bounded.usedBytes;
    });
    child.stderr.on("data", (chunk) => {
      const bounded = appendBounded(stderr, chunk, outputBytes);
      stderr = bounded.output;
      outputBytes = bounded.usedBytes;
    });

    child.once("error", (error) => finish(() => rejectHook(error)));
    child.stdin.once("error", (error) => finish(() => rejectHook(error)));
    child.once("close", (code) => {
      finish(() => {
        if (timedOut) {
              rejectHook(
                new Error(
                  `Claude PreToolUse hook timed out after ${Math.ceil(timeoutMs / 1000)}s: ${hook.command}`,
                ),
              );
          return;
        }

        if (code !== 0) {
          rejectHook(new Error(hookBlockReason(hook.command, code, stdout, stderr)));
          return;
        }

        resolveHook();
      });
    });

    try {
      child.stdin.end(payload);
    } catch (error) {
      finish(() => rejectHook(error));
    }
  });
}

async function runClaudePreToolUseHooks(
  project: ClaudeProject,
  toolName: PiToolName,
  params: unknown,
): Promise<void> {
  const matchingHooks = readClaudePreToolUseHooks(project)
    .filter((entry) => matcherMatchesTool(entry.matcher, toolName))
    .flatMap((entry) => entry.hooks);

      if (matchingHooks.length === 0) return;
      if (matchingHooks.length > MAX_PRE_TOOL_USE_HOOKS) {
        throw new Error(
          `Claude PreToolUse hook limit exceeded: ${matchingHooks.length} hooks configured, maximum is ${MAX_PRE_TOOL_USE_HOOKS}.`,
        );
      }

      const payload = JSON.stringify({
    tool_name: claudeToolAliases(toolName)[1] ?? toolName,
    pi_tool_name: toolName,
    tool_input: params,
  });

  const tempDir = await mkdtemp(join(tmpdir(), "pi-claude-hook-"));
  const inputFile = join(tempDir, "tool-input.json");

  try {
        await writeFile(inputFile, payload, "utf8");
        const deadline = Date.now() + MAX_HOOK_BATCH_TIMEOUT_MS;
        for (const hook of matchingHooks) {
          const remainingMs = deadline - Date.now();
          if (remainingMs <= 0) {
            throw new Error(
              `Claude PreToolUse hook batch timed out after ${MAX_HOOK_BATCH_TIMEOUT_MS / 1000}s.`,
            );
          }
          await runCommandHook(
            project,
            hook,
            payload,
            inputFile,
            Math.min(hook.timeoutSeconds * 1000, remainingMs),
          );
        }
  } finally {
    await unlink(inputFile).catch(() => undefined);
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function registerClaudePreToolUseHooks(
  pi: ExtensionAPI,
  resolveProject: ClaudeProjectResolver = findClaudeProject,
): void {
  pi.on("tool_call", async (event, ctx) => {
    if (!PI_TOOL_NAMES.has(event.toolName) || !isProjectTrusted(ctx)) return;

    const project = resolveProject(ctx.cwd);
    if (!project) return;

    try {
      await runClaudePreToolUseHooks(project, event.toolName as PiToolName, event.input);
    } catch (error) {
      return {
        block: true,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
