import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const { default: registerAdapter } = await import(new URL("../src/index.ts", import.meta.url).href);

test("discovers validated nested skills at their original paths and rejects unsupported restrictions", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-skills-lifecycle-"));
  const skills = join(root, ".claude", "skills");
  const kept = join(skills, "nested", "supported", "SKILL.md");
  const rejected = join(skills, "restricted", "SKILL.md");
  await mkdir(join(root, ".git"));
  await mkdir(join(skills, "nested", "supported"), { recursive: true });
  await mkdir(join(skills, "restricted"), { recursive: true });
  await writeFile(kept, "---\nname: supported\ndescription: A supported skill.\ndisable-model-invocation: true\n---\nSee references/guide.md.");
  await mkdir(join(skills, "nested", "supported", "references"));
  await writeFile(join(skills, "nested", "supported", "references", "guide.md"), "Supporting files remain beside the source skill.");
  await writeFile(rejected, "---\nname: restricted\ndescription: Requires a Claude-only tool allowlist.\nallowed-tools:\n  - Bash\n---\nMust not be exposed without that restriction.");
  await mkdir(join(skills, "malformed"));
  await writeFile(join(skills, "malformed", "SKILL.md"), "---\nname: broken\n---\nNo description.");

  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown> | unknown>();
  const pi = { on: (name: string, handler: (event: unknown, ctx: unknown) => Promise<unknown> | unknown) => handlers.set(name, handler), registerTool() {} } as unknown as ExtensionAPI;
  registerAdapter(pi);
  const notifications: string[] = [];
  const context = { cwd: root, isProjectTrusted: () => true, ui: { notify: (message: string) => notifications.push(message) } };
  try {
    const handler = handlers.get("resources_discover");
    assert.ok(handler);
    const result = await handler({}, context) as { skillPaths?: string[] } | undefined;
    assert.deepEqual(result?.skillPaths, [kept]);
    assert.ok(notifications.some((message) => /restricted/.test(message) && /allowed-tools/.test(message)));
    assert.ok(notifications.some((message) => /malformed/.test(message) && /name\/description/.test(message)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not discover skills from untrusted or sibling projects", async () => {
  const parent = await mkdtemp(join(tmpdir(), "claude-skills-isolation-"));
  const first = join(parent, "first");
  const second = join(parent, "second");
  const secondSkill = join(second, ".claude", "skills", "only-second", "SKILL.md");
  for (const root of [first, second]) await mkdir(join(root, ".git"), { recursive: true });
  await mkdir(join(second, ".claude", "skills", "only-second"), { recursive: true });
  await writeFile(secondSkill, "---\nname: only-second\ndescription: Second project skill.\n---\nInstructions.");
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown> | unknown>();
  const pi = { on: (name: string, handler: (event: unknown, ctx: unknown) => Promise<unknown> | unknown) => handlers.set(name, handler), registerTool() {} } as unknown as ExtensionAPI;
  registerAdapter(pi);
  const discover = handlers.get("resources_discover");
  assert.ok(discover);
  const context = (cwd: string, trusted: boolean) => ({ cwd, isProjectTrusted: () => trusted, ui: { notify() {} } });
  try {
    assert.equal(await discover({}, context(second, false)), undefined);
    const result = await discover({}, context(first, true)) as { skillPaths?: string[] } | undefined;
    assert.equal(result, undefined);
    const sibling = await discover({}, context(second, true)) as { skillPaths?: string[] } | undefined;
    assert.deepEqual(sibling?.skillPaths, [secondSkill]);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("bounds skill diagnostics per discovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-skills-diagnostics-"));
  const skills = join(root, ".claude", "skills");
  await mkdir(join(root, ".git"));
  for (let index = 0; index < 25; index++) {
    const dir = join(skills, `invalid-${String(index).padStart(2, "0")}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), ["---", "name: invalid", "---", "Missing description."].join("\n"));
  }
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown> | unknown>();
  const pi = { on: (name: string, handler: (event: unknown, ctx: unknown) => Promise<unknown> | unknown) => handlers.set(name, handler), registerTool() {} } as unknown as ExtensionAPI;
  registerAdapter(pi);
  const notices: string[] = [];
  const discover = handlers.get("resources_discover");
  assert.ok(discover);
  try {
    await discover({}, { cwd: root, isProjectTrusted: () => true, ui: { notify: (message: string) => notices.push(message) } });
    assert.equal(notices.length, 20);
    assert.ok(notices.every((message) => message.length <= 256));
    assert.match(notices.at(-1) ?? "", /additional Claude skill diagnostics suppressed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
