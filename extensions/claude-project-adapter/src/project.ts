import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type ClaudeProject = {
  root: string;
  claudeDir: string;
  rulesDir: string;
  skillsDir: string;
  commandsDir: string;
};

export type ClaudeProjectResolver = (startDir: string) => ClaudeProject | undefined;
export function createClaudeProjectResolver(): ClaudeProjectResolver {
  // Resolve afresh so cwd changes, filesystem edits and resource reloads cannot
  // reuse a cached project from another location.
  return (startDir) => findClaudeProject(resolve(startDir));
}

export function findClaudeProject(startDir: string): ClaudeProject | undefined {
  let current = resolve(startDir);
  const home = resolve(homedir());

  while (true) {
    const claudeDir = join(current, ".claude");

    // ~/.claude is Claude Code's user-level configuration, not a project-local
    // .claude directory. Do not let sessions opened under nested repos (for
    // example ~/.config) accidentally inherit it while walking upward.
    if (current !== home && isDirectory(claudeDir)) {
      return {
        root: current,
        claudeDir,
        rulesDir: join(claudeDir, "rules"),
        skillsDir: join(claudeDir, "skills"),
        commandsDir: join(claudeDir, "commands"),
      };
    }

    // Stop at repository boundaries. A parent directory's .claude belongs to a
    // different project/user scope and should not bleed into this workspace.
    if (exists(join(current, ".git"))) return undefined;

    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function isProjectTrusted(ctx: Pick<ExtensionContext, "isProjectTrusted">): boolean {
  try {
    return ctx.isProjectTrusted();
  } catch {
    return false;
  }
}

function exists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}
