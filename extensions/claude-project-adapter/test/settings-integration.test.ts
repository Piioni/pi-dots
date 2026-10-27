import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const { createClaudeProjectResolver } = await import(new URL("../src/project.ts", import.meta.url).href);
const { default: registerAdapter } = await import(new URL("../src/index.ts", import.meta.url).href);
const { loadClaudeSettings } = await import(new URL("../src/settings.ts", import.meta.url).href);

test("keeps settings and diagnostics isolated when resolution moves between projects", async () => {
  const parent = await mkdtemp(join(tmpdir(), "claude-settings-isolation-"));
  const first = join(parent, "first");
  const second = join(parent, "second");
  const firstClaude = join(first, ".claude");
  const secondClaude = join(second, ".claude");
  await Promise.all([
    mkdir(join(first, ".git"), { recursive: true }),
    mkdir(join(second, ".git"), { recursive: true }),
    mkdir(firstClaude, { recursive: true }),
    mkdir(secondClaude, { recursive: true }),
  ]);
  await writeFile(join(firstClaude, "settings.json"), JSON.stringify({ setting: "shared" }));
  await writeFile(join(firstClaude, "settings.local.json"), JSON.stringify({ setting: "local", hooks: { Stop: [] } }));
  await writeFile(join(secondClaude, "settings.json"), JSON.stringify({ setting: "second" }));
  const resolveProject = createClaudeProjectResolver();
  try {
    const firstProject = resolveProject(first);
    const secondProject = resolveProject(second);
    assert.ok(firstProject && secondProject);
    assert.equal(loadClaudeSettings(firstProject.claudeDir).settings.setting, "shared");
    assert.equal(loadClaudeSettings(secondProject.claudeDir).settings.setting, "second");
    const firstSettings = loadClaudeSettings(firstProject.claudeDir);
    assert.equal(firstSettings.diagnostics.length, 1);
    assert.equal(firstSettings.diagnostics.some((message: string) => message.includes("Stop")), false);
    assert.equal(loadClaudeSettings(secondProject.claudeDir).diagnostics.length, 1);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("reports trusted settings through extension lifecycle with isolation and fresh discovery", async () => {
  const parent = await mkdtemp(join(tmpdir(), "claude-lifecycle-"));
  const first = join(parent, "first");
  const second = join(parent, "second");
  const outside = join(parent, "outside");
  const firstClaude = join(first, ".claude");
  const secondClaude = join(second, ".claude");
  await Promise.all([
    mkdir(join(first, ".git"), { recursive: true }),
    mkdir(join(second, ".git"), { recursive: true }),
    mkdir(join(outside, ".git"), { recursive: true }),
    mkdir(firstClaude, { recursive: true }),
    mkdir(secondClaude, { recursive: true }),
  ]);
  await writeFile(join(firstClaude, "settings.json"), '{"hooks":{"PostToolUse":[]}}');
  await writeFile(join(secondClaude, "settings.json"), '{"hooks":{"PostToolUseFailure":[]}}');

  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown> | unknown>();
  const pi = {
    on(event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown> | unknown) {
      handlers.set(event, handler);
    },
    registerCommand() {},
    registerTool() {},
    sendUserMessage() {},
  } as unknown as ExtensionAPI;
  registerAdapter(pi);
  const discovery = handlers.get("resources_discover");
  const sessionStart = handlers.get("session_start");
  assert.ok(discovery && sessionStart);

  const notifications: string[] = [];
  const context = (cwd: string, trusted: boolean) => ({
    cwd,
    isProjectTrusted: () => trusted,
    ui: { notify: (message: string) => notifications.push(message) },
  });
  try {
    await discovery({}, context(first, false));
    assert.equal(notifications.length, 0);
    await discovery({}, context(first, true));
    await sessionStart({}, context(first, true));
    await discovery({}, context(first, true));
    assert.deepEqual(notifications, ["Claude hook event 'PostToolUse' is not supported yet and was not run."]);

    await sessionStart({}, context(second, true));
    assert.equal(notifications.length, 2);
    assert.match(notifications[1], /PostToolUseFailure/);
    await sessionStart({}, context(outside, true));
    assert.equal(notifications.length, 2);

    await writeFile(join(firstClaude, "settings.json"), '{"hooks":{"PreCompact":[]}}');
    await discovery({}, context(first, true));
    assert.equal(notifications.length, 3);
    assert.match(notifications[2], /PreCompact/);

    const saturatedProjects = Array.from({ length: 65 }, (_, index) => join(parent, `project-${index}`));
    await Promise.all(saturatedProjects.map(async (root) => {
      const claude = join(root, ".claude");
      await mkdir(join(root, ".git"), { recursive: true });
      await mkdir(claude);
      await writeFile(join(claude, "settings.json"), '{"hooks":{"PostToolUse":[]}}');
    }));
    for (const root of saturatedProjects) await sessionStart({}, context(root, true));
    assert.equal(notifications.length, 68);

    await discovery({}, context(first, false));
    await sessionStart({}, context(first, true));
    assert.equal(notifications.length, 69);
    await sessionStart({}, context(outside, true));
    await sessionStart({}, context(first, true));
    assert.equal(notifications.length, 70);
    await sessionStart({}, context(first, true));
    assert.equal(notifications.length, 70);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
