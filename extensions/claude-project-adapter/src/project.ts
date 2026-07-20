import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export type ClaudeProject = {
  root: string;
  claudeDir: string;
  rulesDir: string;
  skillsDir: string;
  commandsDir: string;
  settingsPath: string;
};

export function findClaudeProject(startDir: string): ClaudeProject | undefined {
  let current = resolve(startDir);
  const home = resolve(homedir());

  while (true) {
    const claudeDir = join(current, ".claude");

    // ~/.claude is Claude Code's user-level configuration, not a project-local
    // .claude directory. Do not let sessions opened under nested repos (for
    // example ~/.config) accidentally inherit it while walking upward.
    if (current !== home && existsSync(claudeDir) && statSync(claudeDir).isDirectory()) {
      return {
        root: current,
        claudeDir,
        rulesDir: join(claudeDir, "rules"),
        skillsDir: join(claudeDir, "skills"),
        commandsDir: join(claudeDir, "commands"),
        settingsPath: join(claudeDir, "settings.json"),
      };
    }

    // Stop at repository boundaries. A parent directory's .claude belongs to a
    // different project/user scope and should not bleed into this workspace.
    const gitPath = join(current, ".git");
    if (existsSync(gitPath)) return undefined;

    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function listMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];

  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => join(dir, entry))
    .sort((a, b) => basename(a).localeCompare(basename(b)));
}

export function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

export function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}
