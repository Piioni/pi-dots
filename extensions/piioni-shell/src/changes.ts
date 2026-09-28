import { readFile } from "node:fs/promises";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type ChangeStatus = "modified" | "added" | "deleted" | "renamed" | "untracked";
export interface ChangedFile { path: string; added: number; deleted: number; status: ChangeStatus; }
export interface ChangesModel { files: ChangedFile[]; added: number; deleted: number; }
export interface GitResult { stdout: string; code: number; }
export type GitRunner = (args: string[]) => Promise<GitResult>;

const statuses = { A: "added", D: "deleted", R: "renamed", C: "added", "?": "untracked" } satisfies Record<string, ChangeStatus>;

function statusForCode(code: string): ChangeStatus {
  return statuses[code as keyof typeof statuses] ?? "modified";
}

export function parseNumstat(text: string): Map<string, { added: number; deleted: number }> {
  const result = new Map<string, { added: number; deleted: number }>();
  for (const line of text.split("\n")) {
    const [added, deleted, ...path] = line.split("\t");
    if (!added || !deleted || path.length === 0) continue;
    result.set(path.join("\t"), { added: Number.parseInt(added, 10) || 0, deleted: Number.parseInt(deleted, 10) || 0 });
  }
  return result;
}

export function parseStatus(text: string): Array<{ path: string; status: ChangeStatus }> {
  const result: Array<{ path: string; status: ChangeStatus }> = [];
  for (const record of text.split("\0").filter(Boolean)) {
    const code = record.slice(0, 2);
    const path = record.slice(3);
    result.push({ path, status: statusForCode(code[0] ?? "") === "modified" ? statusForCode(code[1] ?? "") : statusForCode(code[0] ?? "") });
  }
  return result;
}

export function buildChanges(numstat: string, status: string, untrackedLines: Map<string, number> = new Map()): ChangesModel {
  const counts = parseNumstat(numstat);
  const files = parseStatus(status).map(({ path, status: fileStatus }) => {
    const count = counts.get(path);
    return {
      path,
      status: fileStatus,
      added: count?.added ?? (fileStatus === "untracked" ? untrackedLines.get(path) ?? 0 : 0),
      deleted: count?.deleted ?? 0,
    };
  }).sort((a, b) => a.path.localeCompare(b.path));
  return { files, added: files.reduce((sum, file) => sum + file.added, 0), deleted: files.reduce((sum, file) => sum + file.deleted, 0) };
}

export function changesFingerprint(model: ChangesModel): string {
  return model.files.map((file) => `${file.path}:${file.status}:${file.added}:${file.deleted}`).join("|");
}

export async function countLines(root: string, path: string): Promise<number> {
  try {
    const text = await readFile(`${root}/${path}`, "utf8");
    if (text.length === 0) return 0;
    const lineCount = text.split("\n").length;
    return text.endsWith("\n") ? lineCount - 1 : lineCount;
  } catch {
    return 0;
  }
}

export async function readChanges(git: GitRunner, root: string): Promise<ChangesModel | undefined> {
  const [numstat, status] = await Promise.all([
    git(["diff", "--numstat", "HEAD"]),
    git(["status", "--porcelain=v1", "--untracked-files=all", "-z"]),
  ]);
  if (status.code !== 0) return undefined;
  const untracked = new Map<string, number>();
  for (const file of parseStatus(status.stdout)) {
    if (file.status === "untracked") untracked.set(file.path, await countLines(root, file.path));
  }
  return buildChanges(numstat.stdout, status.stdout, untracked);
}

export function renderChangesWidget(model: ChangesModel, theme: { fg(color: string, text: string): string }, width: number, command = "/gentle:changes"): string[] {
  if (model.files.length === 0) return [];
  const noun = model.files.length === 1 ? "file" : "files";
  const dot = theme.fg("muted", "·");
  const head = `${theme.fg("accent", "✎")} ${theme.fg("text", `${model.files.length} ${noun}`)} ${dot} ${theme.fg("success", `+${model.added}`)} ${theme.fg("error", `−${model.deleted}`)}`;
  const hint = theme.fg("dim", command);
  const list = model.files.map((file) => theme.fg("muted", file.path)).join(` ${dot} `);
  const left = `${head} ${dot} ${list}`;
  const gap = width - visibleWidth(left) - visibleWidth(hint);
  if (gap >= 2) return [`${left}${" ".repeat(gap)}${hint}`];
  return [truncateToWidth(head, Math.max(0, width), "…")];
}
