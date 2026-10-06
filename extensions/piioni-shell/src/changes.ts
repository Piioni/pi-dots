import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
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

interface FileMetadata {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  ino: number;
  dev: number;
}

interface CachedLineCount extends FileMetadata {
  lines: number;
}

function metadataMatches(left: FileMetadata, right: FileMetadata): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs && left.ino === right.ino && left.dev === right.dev;
}

async function fileMetadata(path: string): Promise<FileMetadata | undefined> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return undefined;
    return { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, ino: info.ino, dev: info.dev };
  } catch {
    return undefined;
  }
}

async function streamLineCount(path: string): Promise<number> {
  let bytes = 0;
  let newlines = 0;
  let lastByte = -1;
  let hasNul = false;
  const stream = createReadStream(path);
  for await (const chunk of stream) {
    const buffer = chunk as Buffer;
    if (buffer.includes(0)) {
      hasNul = true;
      // Exiting the async iterator destroys the stream instead of draining binary content.
      break;
    }
    bytes += buffer.length;
    for (const byte of buffer) {
      if (byte === 10) newlines += 1;
      lastByte = byte;
    }
  }
  if (hasNul || bytes === 0) return 0;
  return newlines + (lastByte === 10 ? 0 : 1);
}

export interface ChangesReader {
  read(git: GitRunner, root: string): Promise<ChangesModel | undefined>;
  clear(): void;
}

export function createChangesReader(): ChangesReader {
  const cache = new Map<string, CachedLineCount>();
  let cachedRoot: string | undefined;
  let generation = 0;

  const clear = () => {
    generation += 1;
    cache.clear();
    cachedRoot = undefined;
  };

  const selectRoot = (root: string) => {
    if (root === cachedRoot) return;
    generation += 1;
    cache.clear();
    cachedRoot = root;
  };

  return {
    clear,
    async read(git, root) {
      selectRoot(root);
      const readGeneration = generation;
      const isCurrent = () => generation === readGeneration && cachedRoot === root;
      const [numstat, status] = await Promise.all([
        git(["diff", "--numstat", "HEAD"]),
        git(["status", "--porcelain=v1", "--untracked-files=all", "-z"]),
      ]);
      if (status.code !== 0) return undefined;
      const untracked = parseStatus(status.stdout).filter((file) => file.status === "untracked");
      if (isCurrent()) {
        const livePaths = new Set(untracked.map((file) => file.path));
        for (const path of cache.keys()) if (!livePaths.has(path)) cache.delete(path);
      }

      const counts = new Map<string, number>();
      for (const file of untracked) {
        const absolutePath = resolve(root, file.path);
        let count = 0;
        // Retry once if metadata changes while streaming; never retain an unstable observation.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const before = await fileMetadata(absolutePath);
          if (!before) {
            if (isCurrent()) cache.delete(file.path);
            break;
          }
          const cached = isCurrent() ? cache.get(file.path) : undefined;
          if (cached && metadataMatches(cached, before)) {
            count = cached.lines;
            break;
          }
          try {
            count = await streamLineCount(absolutePath);
          } catch {
            if (isCurrent()) cache.delete(file.path);
            break;
          }
          const after = await fileMetadata(absolutePath);
          if (after && metadataMatches(before, after)) {
            if (isCurrent()) cache.set(file.path, { ...after, lines: count });
            break;
          }
          if (isCurrent()) cache.delete(file.path);
          count = 0;
        }
        counts.set(file.path, count);
      }
      return buildChanges(numstat.stdout, status.stdout, counts);
    },
  };
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
