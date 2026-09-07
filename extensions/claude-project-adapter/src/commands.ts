import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ALLOWED_CLAUDE_COMMAND_NAMES, RESERVED_PI_COMMAND_NAMES } from "./config";
import { readFrontmatterDescription, stripFrontmatter } from "./frontmatter";
import type { ClaudeProject, ClaudeProjectResolver } from "./project";
import { findClaudeProject, isDirectory, isFile, listMarkdownFiles } from "./project";

export function getClaudeCommandFiles(project: ClaudeProject): Array<{ name: string; path: string }> {
  if (!isDirectory(project.commandsDir)) return [];

  return listMarkdownFiles(project.commandsDir).map((path) => ({
    name: basename(path, ".md"),
    path,
  }));
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
  if (!project) return undefined;

  const path = join(project.commandsDir, `${commandName}.md`);
  if (!isFile(path)) return undefined;

  return path;
}

function getCommandDescription(path: string): string {
  const raw = readFileSync(path, "utf8");
  const frontmatterDescription = readFrontmatterDescription(raw);
  if (frontmatterDescription) return frontmatterDescription;

  const body = stripFrontmatter(raw);
  const firstLine = body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#"));

  return firstLine ?? "Run a project-local Claude command through Pi.";
}

export function buildClaudeCommandPrompt(commandName: string, commandPath: string, args: string): string {
  const raw = readFileSync(commandPath, "utf8");
  const body = stripFrontmatter(raw).trim();
  const renderedBody = body
    .replaceAll("$ARGUMENTS", args)
    .replaceAll("$1", args.split(/\s+/)[0] ?? "")
    .replaceAll("$2", args.split(/\s+/)[1] ?? "")
    .replaceAll("$3", args.split(/\s+/)[2] ?? "");

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
    renderedBody,
  ].join("\n");
}

export function registerClaudeCommandsForProject(
  pi: ExtensionAPI,
  project: ClaudeProject,
  registeredCommandNames: Set<string>,
  resolveProject: ClaudeProjectResolver = findClaudeProject,
): void {
  for (const command of getClaudeCommandFiles(project)) {
    if (!ALLOWED_CLAUDE_COMMAND_NAMES.has(command.name)) continue;

    const piCommandName = piCommandNameForClaudeCommand(command.name);
    if (registeredCommandNames.has(piCommandName)) continue;

    registeredCommandNames.add(piCommandName);
    pi.registerCommand(piCommandName, {
      description: getCommandDescription(command.path),
      handler: async (args, ctx) => {
        const commandPath = getClaudeCommandPath(ctx.cwd, command.name, resolveProject);
        if (!commandPath) {
          ctx.ui.notify(`No .claude command found for /${command.name} in this project.`, "info");
          return;
        }

        await pi.sendUserMessage(buildClaudeCommandPrompt(command.name, commandPath, args ?? ""));
      },
    });
  }
}
