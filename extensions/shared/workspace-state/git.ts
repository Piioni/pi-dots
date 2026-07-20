import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { GitStateSummary, GitStatusSummary } from "./types";

const GIT_STATUS_TIMEOUT_MS = 2_000;

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

function emptyGitStatusSummary(): GitStatusSummary {
  return {
    conflicted: 0,
    ahead: 0,
    behind: 0,
    untracked: 0,
    modified: 0,
    staged: 0,
    renamed: 0,
    deleted: 0,
  };
}

const CONFLICT_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

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

export async function getGitStatusFromCwd(cwd: string): Promise<GitStatusSummary> {
  return new Promise((resolveStatus) => {
    execFile(
      "git",
      ["status", "--porcelain=v1", "--branch"],
      { cwd, timeout: GIT_STATUS_TIMEOUT_MS },
      (error, stdout) => {
        if (error) {
          resolveStatus(emptyGitStatusSummary());
          return;
        }

        const summary = emptyGitStatusSummary();
        const lines = stdout.split("\n").map((line) => line.trimEnd()).filter(Boolean);

        for (const line of lines) {
          if (line.startsWith("## ")) {
            const aheadMatch = line.match(/ahead (\d+)/);
            const behindMatch = line.match(/behind (\d+)/);
            summary.ahead = aheadMatch ? Number(aheadMatch[1]) : 0;
            summary.behind = behindMatch ? Number(behindMatch[1]) : 0;
            continue;
          }

          const code = line.slice(0, 2);
          const indexStatus = code[0];
          const worktreeStatus = code[1];

          if (code === "??") {
            summary.untracked += 1;
            continue;
          }

          if (CONFLICT_CODES.has(code)) {
            summary.conflicted += 1;
            continue;
          }

          if (indexStatus === "R" || worktreeStatus === "R") summary.renamed += 1;
          if (indexStatus === "D" || worktreeStatus === "D") summary.deleted += 1;
          if (worktreeStatus === "M" || worktreeStatus === "T") summary.modified += 1;
          if (
            indexStatus !== " " &&
            indexStatus !== "?" &&
            indexStatus !== "U"
          ) {
            summary.staged += 1;
          }
        }

        resolveStatus(summary);
      },
    );
  });
}
