import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { GitStateSummary } from "./types";

const MAX_REPO_WALK_DEPTH = 12;

function readTrimmed(path: string): string | undefined {
  try {
    const value = readFileSync(path, "utf8").trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function resolveGitDir(dotGitPath: string): string | undefined {
  try {
    if (statSync(dotGitPath).isDirectory()) return dotGitPath;
  } catch {
    return undefined;
  }

  const content = readTrimmed(dotGitPath);
  const match = content?.match(/^gitdir:\s*(.+)$/i);
  if (!match) return undefined;

  return resolve(dirname(dotGitPath), match[1]);
}

function findGitDir(cwd: string): string | undefined {
  let current = cwd;

  for (let depth = 0; depth <= MAX_REPO_WALK_DEPTH; depth += 1) {
    const dotGitPath = join(current, ".git");
    if (existsSync(dotGitPath)) return resolveGitDir(dotGitPath);

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return undefined;
}

export function getGitBranchFromCwd(cwd: string): string | undefined {
  const gitDir = findGitDir(cwd);
  if (!gitDir) return undefined;

  const head = readTrimmed(join(gitDir, "HEAD"));
  if (!head) return undefined;

  const refPrefix = "ref: refs/heads/";
  if (head.startsWith(refPrefix)) return head.slice(refPrefix.length);

  return "detached";
}

function readProgress(gitDir: string, currentPath: string, totalPath: string) {
  const current = Number(readTrimmed(join(gitDir, currentPath)));
  const total = Number(readTrimmed(join(gitDir, totalPath)));
  if (Number.isFinite(current) && Number.isFinite(total)) {
    return { current, total };
  }
  return undefined;
}

export function getGitStateFromCwd(cwd: string): GitStateSummary | undefined {
  const gitDir = findGitDir(cwd);
  if (!gitDir) return undefined;

  if (existsSync(join(gitDir, "rebase-merge"))) {
    return {
      label: "REBASING",
      progress: readProgress(gitDir, "rebase-merge/msgnum", "rebase-merge/end"),
    };
  }

  if (existsSync(join(gitDir, "rebase-apply"))) {
    const rebasing = existsSync(join(gitDir, "rebase-apply", "rebasing"));
    const applying = existsSync(join(gitDir, "rebase-apply", "applying"));
    return {
      label: rebasing ? "REBASING" : applying ? "AM" : "APPLYING",
      progress: readProgress(gitDir, "rebase-apply/next", "rebase-apply/last"),
    };
  }

  if (existsSync(join(gitDir, "MERGE_HEAD"))) return { label: "MERGING" };
  if (existsSync(join(gitDir, "CHERRY_PICK_HEAD"))) return { label: "CHERRY-PICKING" };
  if (existsSync(join(gitDir, "REVERT_HEAD"))) return { label: "REVERTING" };
  if (existsSync(join(gitDir, "BISECT_LOG"))) return { label: "BISECTING" };

  return undefined;
}
