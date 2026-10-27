import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_HOOK_TIMEOUT_SECONDS,
  HOOK_KILL_GRACE_MS,
  MAX_HOOK_BATCH_TIMEOUT_MS,
  MAX_HOOK_OUTPUT_BYTES,
  MAX_HOOK_TIMEOUT_SECONDS,
  MAX_LIFECYCLE_HOOK_TIMEOUT_SECONDS,
  MAX_LIFECYCLE_HOOK_BATCH_TIMEOUT_MS,
  MAX_PRE_TOOL_USE_HOOKS,
  PI_TOOL_NAMES,
  type PiToolName,
} from "./config.ts";
import type { ClaudeProject, ClaudeProjectResolver } from "./project.ts";
import { findClaudeProject, isProjectTrusted } from "./project.ts";
import { loadClaudeSettings } from "./settings.ts";

type ClaudeCommandHook = { command: string; timeoutSeconds: number; async?: boolean };
type ClaudeHookEntry = { matcher?: string; hooks: ClaudeCommandHook[] };
type HookResult = { stdout: string; stderr: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readHooks(project: ClaudeProject, eventName: string, maxTimeout: number): ClaudeHookEntry[] {
  const { settings } = loadClaudeSettings(project.claudeDir);
  const hookSettings = Object.hasOwn(settings, "hooks") ? settings.hooks : undefined;
  if (!isRecord(hookSettings)) return [];
  const entries = Object.hasOwn(hookSettings, eventName) ? hookSettings[eventName] : undefined;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry): ClaudeHookEntry[] => {
    if (!isRecord(entry) || !Object.hasOwn(entry, "hooks") || !Array.isArray(entry.hooks)) return [];
    const hooks = entry.hooks.flatMap((hook): ClaudeCommandHook[] => {
      if (!isRecord(hook) || !Object.hasOwn(hook, "type") || hook.type !== "command") return [];
      const command = Object.hasOwn(hook, "command") ? hook.command : undefined;
      if (typeof command !== "string") return [];
      const timeout = Object.hasOwn(hook, "timeout") ? hook.timeout : undefined;
      const timeoutSeconds = typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0
        ? Math.min(timeout, maxTimeout)
        : DEFAULT_HOOK_TIMEOUT_SECONDS;
      return [{ command, timeoutSeconds, async: hook.async === true }];
    });
    if (hooks.length === 0) return [];
    const matcher = Object.hasOwn(entry, "matcher") ? entry.matcher : undefined;
    return [{ matcher: typeof matcher === "string" ? matcher : undefined, hooks }];
  });
}

function claudeToolAliases(toolName: PiToolName): string[] {
  switch (toolName) {
    case "bash": return ["bash", "Bash"];
    case "edit": return ["edit", "Edit", "MultiEdit"];
    case "write": return ["write", "Write"];
    case "read": return ["read", "Read"];
    case "grep": return ["grep", "Grep"];
    case "find": return ["find", "Find", "Glob"];
    case "ls": return ["ls", "LS", "List"];
  }
}

function matcherMatches(matcher: string | undefined, source: string | undefined): boolean {
  if (source === undefined) return matcher === undefined || matcher.trim() === "" || matcher.trim() === "*";
  if (!matcher || matcher.trim() === "" || matcher.trim() === "*") return true;
  try {
    return new RegExp(`^(?:${matcher})$`).test(source);
  } catch {
    return matcher.split(/[|,\s]+/).filter(Boolean).includes(source);
  }
}

function hookEnvironment(inputFile: string, project: ClaudeProject): NodeJS.ProcessEnv {
  const inherited = process.env;
  const env: NodeJS.ProcessEnv = {
    HOME: inherited.HOME, LANG: inherited.LANG, LC_ALL: inherited.LC_ALL,
    PATH: inherited.PATH, SHELL: inherited.SHELL, TERM: inherited.TERM,
    TMP: inherited.TMP, TEMP: inherited.TEMP, TMPDIR: inherited.TMPDIR,
    TOOL_INPUT_FILE: inputFile,
    CLAUDE_PROJECT_DIR: project.root,
    SIPOS_ESTADO_TARJETAS_FECHA: join(getAgentDir(), "sipos-estado-tarjetas.fecha"),
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
      const taskkill = spawn("taskkill", ["/pid", `${child.pid}`, "/T", "/F"], { stdio: "ignore", windowsHide: true });
      taskkill.once("error", () => child.kill(signal));
    } catch { child.kill(signal); }
    return;
  }
  try { process.kill(-child.pid, signal); } catch { child.kill(signal); }
}

function appendBounded(output: string, chunk: unknown, usedBytes: number): { output: string; usedBytes: number } {
  const remaining = MAX_HOOK_OUTPUT_BYTES - usedBytes;
  if (remaining <= 0) return { output, usedBytes };
  const value = Buffer.from(String(chunk));
  if (value.byteLength <= remaining) return { output: output + value.toString("utf8"), usedBytes: usedBytes + value.byteLength };
  const marker = Buffer.from("\n[Hook output truncated]");
  if (remaining < marker.byteLength) return { output: output + value.subarray(0, remaining).toString("utf8"), usedBytes: MAX_HOOK_OUTPUT_BYTES };
  const contentBytes = remaining - marker.byteLength;
  return { output: output + value.subarray(0, contentBytes).toString("utf8") + marker.toString("utf8"), usedBytes: MAX_HOOK_OUTPUT_BYTES };
}

function runCommandHook(
  project: ClaudeProject,
  hook: ClaudeCommandHook,
  payload: string,
  inputFile: string,
  timeoutMs = hook.timeoutSeconds * 1000,
  signal?: AbortSignal,
  eventName = "PreToolUse",
): Promise<HookResult> {
  return new Promise((resolveHook, rejectHook) => {
    const child = spawn(hook.command, {
      cwd: project.root, detached: process.platform !== "win32", env: hookEnvironment(inputFile, project),
      shell: true, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let stopping = false;
    let outputBytes = 0;
    let forceKillTimeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (forceKillTimeout && !stopping) clearTimeout(forceKillTimeout);
      callback();
    };
    const stop = () => {
      if (stopping) return;
      stopping = true;
      terminateProcessTree(child, "SIGTERM");
      forceKillTimeout = setTimeout(() => terminateProcessTree(child, "SIGKILL"), HOOK_KILL_GRACE_MS);
      forceKillTimeout.unref();
    };
    const abort = () => stop();
    const timeout = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => {
      const bounded = appendBounded(stdout, chunk, outputBytes); stdout = bounded.output; outputBytes = bounded.usedBytes;
    });
    child.stderr.on("data", (chunk) => {
      const bounded = appendBounded(stderr, chunk, outputBytes); stderr = bounded.output; outputBytes = bounded.usedBytes;
    });
    child.once("error", (error) => finish(() => rejectHook(error)));
    child.stdin.once("error", (error) => finish(() => rejectHook(error)));
    child.once("close", (code) => finish(() => {
      if (signal?.aborted) { rejectHook(new Error("Claude lifecycle hook cancelled.")); return; }
      if (timedOut) {
        rejectHook(new Error(`Claude ${eventName} hook timed out after ${Math.ceil(timeoutMs / 1000)}s: ${hook.command}`));
        return;
      }
      if (code !== 0) {
        rejectHook(eventName === "PreToolUse"
          ? new Error(hookBlockReason(hook.command, code, stdout, stderr))
          : new Error([stderr.trim(), stdout.trim()].filter(Boolean).join("\n") || `Claude ${eventName} hook command exited with code ${code ?? "unknown"}: ${hook.command}`));
        return;
      }
      resolveHook({ stdout, stderr });
    }));
    try { child.stdin.end(payload); } catch (error) { finish(() => rejectHook(error)); }
  });
}

function hookBlockReason(command: string, code: number | null, stdout: string, stderr: string): string {
  const output = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
  return `Claude PreToolUse hook blocked the tool call: ${command}\n${output || `command exited with code ${code ?? "unknown"}`}`;
}

async function runClaudePreToolUseHooks(project: ClaudeProject, toolName: PiToolName, params: unknown): Promise<void> {
  const matchingHooks = readHooks(project, "PreToolUse", MAX_HOOK_TIMEOUT_SECONDS)
    .filter((entry) => matcherMatchesTool(entry.matcher, toolName)).flatMap((entry) => entry.hooks);
  if (matchingHooks.length === 0) return;
  if (matchingHooks.length > MAX_PRE_TOOL_USE_HOOKS) {
    throw new Error(`Claude PreToolUse hook limit exceeded: ${matchingHooks.length} hooks configured, maximum is ${MAX_PRE_TOOL_USE_HOOKS}.`);
  }
  const payload = JSON.stringify({ tool_name: claudeToolAliases(toolName)[1] ?? toolName, pi_tool_name: toolName, tool_input: params });
  const tempDir = await mkdtemp(join(tmpdir(), "pi-claude-hook-"));
  const inputFile = join(tempDir, "tool-input.json");
  try {
    await writeFile(inputFile, payload, "utf8");
    const deadline = Date.now() + MAX_HOOK_BATCH_TIMEOUT_MS;
    for (const hook of matchingHooks) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new Error(`Claude PreToolUse hook batch timed out after ${MAX_HOOK_BATCH_TIMEOUT_MS / 1000}s.`);
      await runCommandHook(project, hook, payload, inputFile, Math.min(hook.timeoutSeconds * 1000, remainingMs));
    }
  } finally {
    await unlink(inputFile).catch(() => undefined);
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function matcherMatchesTool(matcher: string | undefined, toolName: PiToolName): boolean {
  if (!matcher || matcher.trim() === "" || matcher.trim() === "*") return true;
  const aliases = claudeToolAliases(toolName);
  try { const regex = new RegExp(`^(?:${matcher})$`); return aliases.some((alias) => regex.test(alias)); }
  catch { const tokens = matcher.split(/[|,\s]+/).filter(Boolean); return aliases.some((alias) => tokens.includes(alias)); }
}

export function registerClaudePreToolUseHooks(pi: ExtensionAPI, resolveProject: ClaudeProjectResolver = findClaudeProject): void {
  pi.on("tool_call", async (event, ctx) => {
    if (!PI_TOOL_NAMES.has(event.toolName) || !isProjectTrusted(ctx)) return;
    const project = resolveProject(ctx.cwd);
    if (!project) return;
    try { await runClaudePreToolUseHooks(project, event.toolName as PiToolName, event.input); }
    catch (error) { return { block: true, reason: error instanceof Error ? error.message : String(error) }; }
  });
}

function report(ctx: ExtensionContext, error: unknown): void {
  ctx.ui.notify(`Claude hook failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
}

function sessionId(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionId();
}

function lifecyclePayload(event: string, ctx: ExtensionContext, source?: string): string {
  return JSON.stringify({ hook_event_name: event, cwd: ctx.cwd, session_id: sessionId(ctx), ...(source === undefined ? {} : { source }) });
}

export function registerClaudeLifecycleHooks(pi: ExtensionAPI, resolveProject: ClaudeProjectResolver = findClaudeProject): void {
  let generation = 0;
  let activeJobs = new Set<AbortController>();
  const stopAll = () => { generation++; for (const controller of activeJobs) controller.abort(); activeJobs.clear(); };
  pi.on("session_shutdown", () => stopAll());
  pi.on("session_start", async (event, ctx) => {
    stopAll();
    if (event.reason === "reload" || !isProjectTrusted(ctx)) return;
    const project = resolveProject(ctx.cwd);
    if (!project) return;
    const source = ({ startup: "startup", resume: "resume", new: "clear", fork: "fork" } as const)[event.reason];
    if (source === undefined) return;
    const hooks = readHooks(project, "SessionStart", MAX_LIFECYCLE_HOOK_TIMEOUT_SECONDS)
      .filter((entry) => matcherMatches(entry.matcher, source)).flatMap((entry) => entry.hooks);
    if (hooks.length > MAX_PRE_TOOL_USE_HOOKS) { report(ctx, new Error(`Claude SessionStart hook limit exceeded: maximum is ${MAX_PRE_TOOL_USE_HOOKS}.`)); return; }
    if (hooks.length === 0) return;
    const payload = lifecyclePayload("SessionStart", ctx, source);
    const deadline = Date.now() + MAX_LIFECYCLE_HOOK_BATCH_TIMEOUT_MS;
    const currentGeneration = generation;
    const controller = new AbortController();
    activeJobs.add(controller);
    const identity = sessionId(ctx);
    const isCurrent = () => currentGeneration === generation && !controller.signal.aborted && isProjectTrusted(ctx) && resolveProject(ctx.cwd)?.root === project.root && sessionId(ctx) === identity;
    let tempDir: string | undefined;
    let inputFile: string | undefined;
    try {
      tempDir = await mkdtemp(join(tmpdir(), "pi-claude-hook-"));
      inputFile = join(tempDir, "session-start.json");
      await writeFile(inputFile, payload, "utf8");
      for (const hook of hooks) {
        if (!isCurrent()) return;
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) { report(ctx, new Error(`Claude SessionStart hook batch timed out after ${MAX_LIFECYCLE_HOOK_BATCH_TIMEOUT_MS / 1000}s.`)); return; }
        try {
          const result = await runCommandHook(project, hook, payload, inputFile, Math.min(hook.timeoutSeconds * 1000, remainingMs), controller.signal, "SessionStart");
          if (!isCurrent()) return;
          if (result.stdout.trim()) {
            let parsed: unknown;
            try { parsed = JSON.parse(result.stdout); } catch { continue; }
            if (isRecord(parsed) && isRecord(parsed.hookSpecificOutput) && parsed.hookSpecificOutput.hookEventName === "SessionStart" && typeof parsed.hookSpecificOutput.additionalContext === "string") {
              pi.sendMessage({ customType: "claude-session-start", content: parsed.hookSpecificOutput.additionalContext, display: false }, { triggerTurn: false });
            }
          }
        } catch (error) { if (isCurrent()) report(ctx, error); }
      }
    } catch (error) { if (isCurrent()) report(ctx, error); }
    finally {
      activeJobs.delete(controller);
      if (inputFile) await unlink(inputFile).catch(() => undefined);
      if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  pi.on("agent_settled", (event, ctx) => {
    if ((event as typeof event & { aborted?: boolean }).aborted === true || !isProjectTrusted(ctx)) return;
    const project = resolveProject(ctx.cwd);
    if (!project) return;
    for (const controller of activeJobs) controller.abort();
    activeJobs.clear();
    const hooks = readHooks(project, "Stop", MAX_LIFECYCLE_HOOK_TIMEOUT_SECONDS).flatMap((entry) => entry.hooks);
    if (hooks.length > MAX_PRE_TOOL_USE_HOOKS) { report(ctx, new Error(`Claude Stop hook limit exceeded: maximum is ${MAX_PRE_TOOL_USE_HOOKS}.`)); return; }
    const deadline = Date.now() + MAX_LIFECYCLE_HOOK_BATCH_TIMEOUT_MS;
    const currentGeneration = generation;
    for (const hook of hooks) {
      const controller = new AbortController();
      activeJobs.add(controller);
      void (async () => {
        let tempDir: string | undefined;
        let inputFile: string | undefined;
        const identity = sessionId(ctx);
        const isCurrent = () => currentGeneration === generation && !controller.signal.aborted && isProjectTrusted(ctx) && resolveProject(ctx.cwd)?.root === project.root && sessionId(ctx) === identity;
        const payload = lifecyclePayload("Stop", ctx);
        try {
          tempDir = await mkdtemp(join(tmpdir(), "pi-claude-hook-"));
          inputFile = join(tempDir, "stop.json");
          await writeFile(inputFile, payload, "utf8");
          if (!isCurrent()) return;
          const remainingMs = deadline - Date.now();
          if (remainingMs <= 0) throw new Error(`Claude Stop hook batch timed out after ${MAX_LIFECYCLE_HOOK_BATCH_TIMEOUT_MS / 1000}s.`);
          const result = await runCommandHook(project, hook, payload, inputFile, Math.min(hook.timeoutSeconds * 1000, remainingMs), controller.signal, "Stop");
          if (!isCurrent()) return;
          if (result.stdout.trim() || result.stderr.trim()) ctx.ui.notify([result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n"), "info");
        } catch (error) {
          if (isCurrent()) report(ctx, error);
        } finally {
          activeJobs.delete(controller);
          if (inputFile) await unlink(inputFile).catch(() => undefined);
          if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
        }
      })();
    }
  });
}
