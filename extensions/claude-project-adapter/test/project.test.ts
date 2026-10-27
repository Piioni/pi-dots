import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { createClaudeProjectResolver } = await import(new URL("../src/project.ts", import.meta.url).href);

test("resolves project settings from subdirectories and refreshes removed project state", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-project-"));
  const nested = join(root, "packages", "app");
  const claudeDir = join(root, ".claude");
  await mkdir(join(root, ".git"));
  await mkdir(nested, { recursive: true });
  await mkdir(claudeDir);
  const resolveProject = createClaudeProjectResolver();
  try {
    const project = resolveProject(nested);
    assert.equal(project?.root, root);
    assert.equal(project?.claudeDir, claudeDir);
    await rm(claudeDir, { recursive: true, force: true });
    assert.equal(resolveProject(nested), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
