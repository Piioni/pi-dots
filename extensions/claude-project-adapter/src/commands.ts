import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { MAX_COMMAND_BYTES, RESERVED_PI_COMMAND_NAMES } from "./config.ts";
import { parseFrontmatter, readFrontmatterDescription } from "./frontmatter.ts";
import type { ClaudeProject, ClaudeProjectResolver } from "./project.ts";
import { findClaudeProject, isFile, isProjectTrusted } from "./project.ts";

type ClaudeCommand = { name: string; path: string };
type CommandReadResult = { raw: string; body: string; metadata: Map<string, string> } | { error: string };

function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function collectMarkdownFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return collectMarkdownFiles(path);
      return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
    });
  } catch {
    return [];
  }
}

function claudeCommandName(commandsDir: string, path: string): string {
  return relative(commandsDir, path).slice(0, -3).split(/[\\/]/).join(":");
}

function isValidClaudeCommandName(name: string): boolean {
  return name.split(":").every((segment) => /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(segment));
}

export function getClaudeCommandFiles(project: ClaudeProject): ClaudeCommand[] {
  return collectMarkdownFiles(project.commandsDir)
    .map((path) => ({ name: claudeCommandName(project.commandsDir, path), path }))
    .sort((a, b) => comparePaths(a.name, b.name) || comparePaths(a.path, b.path));
}

export function piCommandNameForClaudeCommand(commandName: string): string {
  return RESERVED_PI_COMMAND_NAMES.has(commandName) ? `sipos-${commandName}` : commandName;
}

function getClaudeCommandPath(
  startDir: string,
  commandName: string,
  resolveProject: ClaudeProjectResolver,
): string | undefined {
  const project = resolveProject(startDir);
  if (!project || !isValidClaudeCommandName(commandName)) return undefined;

  const path = join(project.commandsDir, ...commandName.split(":")) + ".md";
  return isFile(path) ? path : undefined;
}

function readClaudeCommandFile(path: string): CommandReadResult {
  try {
    if (statSync(path).size > MAX_COMMAND_BYTES) return { error: "the command file exceeds the adapter size limit" };
    const raw = readFileSync(path, "utf8");
    const parsed = parseFrontmatter(raw);
    if (parsed.error) return { error: parsed.error };
    return { raw, body: parsed.body, metadata: parsed.metadata };
  } catch {
    return { error: "the command file could not be read" };
  }
}

function getCommandDescription(path: string): string {
  const result = readClaudeCommandFile(path);
  if ("error" in result) return "Run a project-local Claude command through Pi.";
  const description = readFrontmatterDescription(result.raw) ?? result.body.split("\n").map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#")) ?? "Run a project-local Claude command through Pi.";
  return [description, result.metadata.get("argument-hint")].filter(Boolean).join(" ");
}

function parseArguments(raw: string): string[] {
  const args: string[] = [];
  let value = "";
  let quote = "";
  let escaped = false;
  let started = false;
  for (const char of raw) {
    if (escaped) {
      value += char;
      escaped = false;
      started = true;
    } else if (char === "\\" && quote !== "'") {
      escaped = true;
      started = true;
    } else if (quote) {
      if (char === quote) quote = "";
      else value += char;
      started = true;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) args.push(value);
      value = "";
      started = false;
    } else {
      value += char;
      started = true;
    }
  }
  if (escaped) value += "\\";
  if (started) args.push(value);
  return args;
}

function expandArguments(body: string, raw: string): string {
  const args = parseArguments(raw);
  return body.replace(/(\\*)\$(ARGUMENTS(?:\[(\d+)\])?|\d+)/g, (_token, slashes: string, key: string, argumentIndex: string | undefined) => {
    const escaped = slashes.length % 2 === 1;
    const prefix = "\\".repeat(escaped ? slashes.length - 1 : slashes.length);
    const placeholder = `$${key}`;
    if (escaped) return prefix + placeholder;
    if (key === "ARGUMENTS") return prefix + raw;
    const index = argumentIndex === undefined ? Number(key) : Number(argumentIndex);
    return index < args.length ? prefix + args[index] : prefix + placeholder;
  });
}

function unsupportedCommandFeature(result: Extract<CommandReadResult, { raw: string }>): string | undefined {
  const unsupported = ["allowed-tools", "disallowed-tools", "agent", "context", "model", "arguments", "hooks"]
    .filter((key) => result.metadata.has(key));
  if (/^false(?:\s+#.*)?$/i.test(result.metadata.get("user-invocable") ?? "")) {
    unsupported.push("user-invocable: false");
  }
  if (/(^|\s)!`|^```!\s*$/m.test(result.body)) unsupported.push("shell injection (!`...`)");
  return unsupported.length > 0
    ? `Claude command features ${unsupported.map((feature) => `'${feature}'`).join(", ")} are not supported; no command prompt was sent and no shell was executed.`
    : undefined;
}

export function buildClaudeCommandPrompt(commandName: string, body: string, args: string): string {
  return [
    `Execute the project-local Claude command \`/${commandName}\` in Pi.`,
    "",
    "These instructions were loaded read-only from `.claude/commands`. Adapt Claude Code-specific wording to Pi when possible.",
    "If the command requires Claude-only tools or unavailable integrations, stop and explain the blocker instead of pretending it ran.",
    "Respect the imported `.claude/rules`, project `CLAUDE.md`, and current repository state.",
    "",
    args ? `User arguments: ${args}` : "User arguments: (none)",
    "",
    "## Command instructions",
    "",
    expandArguments(body.trim(), args),
  ].join("\n");
}

export function registerClaudeCommandsForProject(
  pi: ExtensionAPI,
  project: ClaudeProject,
  registeredCommandNames: Set<string>,
  resolveProject: ClaudeProjectResolver = findClaudeProject,
  diagnose: (message: string) => void = () => {},
): void {
  const otherCommandNames = new Set((pi.getCommands?.() ?? []).map((command) => command.name));
  const currentProjectNames = new Set<string>();
  for (const command of getClaudeCommandFiles(project)) {
    if (!isValidClaudeCommandName(command.name)) {
      diagnose(`Claude command path '${relative(project.commandsDir, command.path)}' has an invalid command name and was ignored.`);
      continue;
    }
    const piCommandName = piCommandNameForClaudeCommand(command.name);
    if (currentProjectNames.has(piCommandName)) {
      diagnose(`Claude command '/${command.name}' collides with another project command and was ignored.`);
      continue;
    }
    currentProjectNames.add(piCommandName);
    if (registeredCommandNames.has(piCommandName)) continue;
    if (otherCommandNames.has(piCommandName)) {
      diagnose(`Claude command '/${command.name}' collides with an existing Pi command and was ignored.`);
      continue;
    }

    registeredCommandNames.add(piCommandName);
    pi.registerCommand(piCommandName, {
      description: getCommandDescription(command.path),
      handler: async (args, ctx) => {
        if (!isProjectTrusted(ctx)) return;

        const commandPath = getClaudeCommandPath(ctx.cwd, command.name, resolveProject);
        if (!commandPath) {
          ctx.ui.notify(`No .claude command found for /${command.name} in this project.`, "info");
          return;
        }

        const result = readClaudeCommandFile(commandPath);
        if ("error" in result) {
          ctx.ui.notify(`Claude command '/${command.name}' was not run: ${result.error}.`, "warning");
          return;
        }
        const unsupported = unsupportedCommandFeature(result);
        if (unsupported) {
          ctx.ui.notify(unsupported, "warning");
          return;
        }

        await pi.sendUserMessage(buildClaudeCommandPrompt(command.name, result.body, args ?? ""));
      },
    });
  }
}
