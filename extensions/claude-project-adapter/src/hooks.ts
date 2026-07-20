import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_HOOK_TIMEOUT_SECONDS, PI_TOOL_NAMES, type PiToolName } from "./config";
import type { ClaudeProject } from "./project";
import { findClaudeProject, isFile } from "./project";

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
            ? hook.timeout
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

function runCommandHook(
  project: ClaudeProject,
  hook: ClaudeCommandHook,
  payload: string,
  inputFile: string,
): Promise<void> {
  return new Promise((resolveHook, rejectHook) => {
    const child = spawn(hook.command, {
      cwd: project.root,
      env: { ...process.env, TOOL_INPUT_FILE: inputFile },
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, hook.timeoutSeconds * 1000);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectHook(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        rejectHook(new Error(`Claude PreToolUse hook timed out after ${hook.timeoutSeconds}s: ${hook.command}`));
        return;
      }

      if (code && code !== 0) {
        rejectHook(new Error(hookBlockReason(hook.command, code, stdout, stderr)));
        return;
      }

      resolveHook();
    });

    child.stdin.end(payload);
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

  const payload = JSON.stringify({
    tool_name: claudeToolAliases(toolName)[1] ?? toolName,
    pi_tool_name: toolName,
    tool_input: params,
  });

  const tempDir = await mkdtemp(join(tmpdir(), "pi-claude-hook-"));
  const inputFile = join(tempDir, "tool-input.json");

  try {
    await writeFile(inputFile, payload, "utf8");
    for (const hook of matchingHooks) {
      await runCommandHook(project, hook, payload, inputFile);
    }
  } finally {
    await unlink(inputFile).catch(() => undefined);
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function registerClaudePreToolUseHooks(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event, ctx) => {
    if (!PI_TOOL_NAMES.has(event.toolName)) return;

    const project = findClaudeProject(ctx.cwd);
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
