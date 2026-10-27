import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const { default: registerAdapter } = await import(new URL("../src/index.ts", import.meta.url).href);

test("imports recursive unscoped rules only and diagnoses scoped rules without replacing prompt sections", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-rules-lifecycle-"));
  const rules = join(root, ".claude", "rules");
  await mkdir(join(root, ".git"));
  await mkdir(join(rules, "nested"), { recursive: true });
  await writeFile(join(rules, "a-scoped.md"), "---\npaths:\n  - src/**/*.ts\n---\nScoped instruction.");
  await writeFile(join(rules, "b-malformed.md"), "---\nname: unterminated");
  await writeFile(join(rules, "nested", "child.md"), "Nested project rule.");
  await writeFile(join(rules, "z-base.md"), "Base project rule.");

  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown> | unknown>();
  const pi = { on: (name: string, handler: (event: unknown, ctx: unknown) => Promise<unknown> | unknown) => handlers.set(name, handler), registerTool() {} } as unknown as ExtensionAPI;
  registerAdapter(pi);
  const notify: string[] = [];
  const context = { cwd: root, isProjectTrusted: () => true, ui: { notify: (message: string) => notify.push(message) } };
  try {
    const handler = handlers.get("before_agent_start");
    assert.ok(handler);
    const result = await handler({
      systemPrompt: "Original system prompt.",
      systemPromptOptions: { cwd: root, promptGuidelines: ["Keep this section."] },
    }, context) as { systemPrompt?: string } | undefined;
    assert.match(result?.systemPrompt ?? "", /Base project rule\./);
    assert.match(result?.systemPrompt ?? "", /Nested project rule\./);
    assert.doesNotMatch(result?.systemPrompt ?? "", /Scoped instruction\./);
    assert.match(result?.systemPrompt ?? "", /Original system prompt\./);
    assert.ok(notify.some((message) => /a-scoped\.md/.test(message) && /path-scoped/.test(message)));
    assert.ok(notify.some((message) => /b-malformed\.md/.test(message) && /malformed frontmatter/.test(message)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports oversized rules and isolates rule prompts from untrusted and sibling projects", async () => {
  const parent = await mkdtemp(join(tmpdir(), "claude-rules-isolation-"));
  const first = join(parent, "first");
  const second = join(parent, "second");
  for (const root of [first, second]) {
    await mkdir(join(root, ".git"), { recursive: true });
    await mkdir(join(root, ".claude", "rules"), { recursive: true });
  }
  await writeFile(join(first, ".claude", "rules", "a-large.md"), "x".repeat(120_001));
  await writeFile(join(first, ".claude", "rules", "b-wrapped.md"), "x".repeat(119_900));
  await writeFile(join(first, ".claude", "rules", "z-valid.md"), "Later valid rule.");
  await writeFile(join(second, ".claude", "rules", "second.md"), "Second project only.");

  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown> | unknown>();
  const pi = { on: (name: string, handler: (event: unknown, ctx: unknown) => Promise<unknown> | unknown) => handlers.set(name, handler), registerTool() {} } as unknown as ExtensionAPI;
  registerAdapter(pi);
  const notices: string[] = [];
  const beforeStart = handlers.get("before_agent_start");
  assert.ok(beforeStart);
  const makeContext = (cwd: string, trusted: boolean) => ({ cwd, isProjectTrusted: () => trusted, ui: { notify: (message: string) => notices.push(message) } });
  try {
    assert.equal(await beforeStart({ systemPrompt: "Base" }, makeContext(first, false)), undefined);
    const oversized = await beforeStart({ systemPrompt: "Base" }, makeContext(first, true)) as { systemPrompt?: string } | undefined;
    assert.match(oversized?.systemPrompt ?? "", /Later valid rule\./);
    assert.ok(Buffer.byteLength((oversized?.systemPrompt ?? "").slice("Base".length + 2), "utf8") <= 120_000);
    assert.ok(notices.some((message) => /a-large\.md/.test(message) && /120000-byte/.test(message)));
    assert.ok(notices.some((message) => /b-wrapped\.md/.test(message) && /120000-byte/.test(message)));
    const sibling = await beforeStart({ systemPrompt: "Base" }, makeContext(second, true)) as { systemPrompt?: string } | undefined;
    assert.match(sibling?.systemPrompt ?? "", /Second project only\./);
    assert.doesNotMatch(sibling?.systemPrompt ?? "", /Later valid rule\./);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("bounds rule diagnostics per prompt", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-rules-diagnostics-"));
  const rules = join(root, ".claude", "rules");
  await mkdir(join(root, ".git"));
  await mkdir(rules, { recursive: true });
  for (let index = 0; index < 25; index++) {
    await writeFile(join(rules, `invalid-${String(index).padStart(2, "0")}.md`), ["---", "name: invalid"].join("\n"));
  }
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown> | unknown>();
  const pi = { on: (name: string, handler: (event: unknown, ctx: unknown) => Promise<unknown> | unknown) => handlers.set(name, handler), registerTool() {} } as unknown as ExtensionAPI;
  registerAdapter(pi);
  const notices: string[] = [];
  const beforeStart = handlers.get("before_agent_start");
  assert.ok(beforeStart);
  try {
    await beforeStart({ systemPrompt: "Base" }, { cwd: root, isProjectTrusted: () => true, ui: { notify: (message: string) => notices.push(message) } });
    assert.equal(notices.length, 20);
    assert.ok(notices.every((message) => Buffer.byteLength(message, "utf8") <= 256));
    assert.match(notices.at(-1) ?? "", /additional Claude rule diagnostics suppressed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
