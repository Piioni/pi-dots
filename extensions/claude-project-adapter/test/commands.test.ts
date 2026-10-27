import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerClaudeCommandsForProject } from "../src/commands.ts";
import { createClaudeProjectResolver } from "../src/project.ts";

type RegisteredHandler = (args: string, ctx: unknown) => Promise<void>;

function commandHarness(existingNames: string[] = []) {
  const commands = new Map<string, { description: string; handler: RegisteredHandler }>();
  const messages: string[] = [];
  const notifications: string[] = [];
  const pi = {
    getCommands: () => existingNames.map((name) => ({ name, source: "extension", sourceInfo: {} })),
    registerCommand: (name: string, options: { description: string; handler: RegisteredHandler }) => {
      commands.set(name, options);
    },
    sendUserMessage: (message: string) => messages.push(message),
  } as unknown as ExtensionAPI;
  const ctx = (cwd: string) => ({
    cwd,
    isProjectTrusted: () => true,
    ui: { notify: (message: string) => notifications.push(message) },
  });
  return { pi, commands, messages, notifications, ctx };
}

async function makeProject(parent: string, name: string) {
  const root = join(parent, name);
  const claudeDir = join(root, ".claude");
  const commandsDir = join(claudeDir, "commands");
  await Promise.all([
    mkdir(join(root, ".git"), { recursive: true }),
    mkdir(commandsDir, { recursive: true }),
  ]);
  return { root, claudeDir, commandsDir, rulesDir: join(claudeDir, "rules"), skillsDir: join(claudeDir, "skills") };
}

test("registers and runs revisar-prs with descriptive argument-hint frontmatter", async () => {
  const parent = await mkdtemp(join(tmpdir(), "claude-revisar-prs-argument-hint-"));
  const project = await makeProject(parent, "project");
  await writeFile(
    join(project.commandsDir, "revisar-prs.md"),
    "---\ndescription: Revisa un PR\nargument-hint: [número de PR]\n---\nRevisa el PR $0.",
  );
  const harness = commandHarness();
  try {
    registerClaudeCommandsForProject(harness.pi, project, new Set(), createClaudeProjectResolver());
    const command = harness.commands.get("revisar-prs");
    assert.ok(command);
    await command.handler("123", harness.ctx(project.root));
    assert.equal(harness.messages.length, 1);
    assert.match(harness.messages[0], /Revisa el PR 123\./);
    assert.match(command.description, /Revisa un PR.*número de PR/);
    assert.equal(harness.notifications.length, 0);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("discovers revisar-prs without a project-specific allowlist", async () => {
  const parent = await mkdtemp(join(tmpdir(), "claude-command-discovery-"));
  const project = await makeProject(parent, "project");
  await writeFile(join(project.commandsDir, "revisar-prs.md"), "Review the pull request.");
  const harness = commandHarness();
  try {
    registerClaudeCommandsForProject(harness.pi, project, new Set(), createClaudeProjectResolver());
    assert.ok(harness.commands.has("revisar-prs"));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("renders Claude indexed arguments with quote grouping and one-pass substitution", async () => {
  const parent = await mkdtemp(join(tmpdir(), "claude-command-arguments-"));
  const project = await makeProject(parent, "project");
  await writeFile(join(project.commandsDir, "pr.md"), "$ARGUMENTS|$ARGUMENTS[0]|$0|$1|$10|$11");
  const harness = commandHarness();
  try {
    registerClaudeCommandsForProject(harness.pi, project, new Set(), createClaudeProjectResolver());
    await harness.commands.get("pr")?.handler('"hello world" two three four five six seven eight nine ten eleven', harness.ctx(project.root));
    assert.equal(harness.messages.length, 1);
    assert.match(harness.messages[0], /User arguments: "hello world" two three four five six seven eight nine ten eleven/);
    assert.match(harness.messages[0], /\n"hello world" two three four five six seven eight nine ten eleven\|hello world\|hello world\|two\|eleven\|\$11$/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("preserves escaped, empty, and placeholder-like argument values", async () => {
  const parent = await mkdtemp(join(tmpdir(), "claude-command-quoted-arguments-"));
  const project = await makeProject(parent, "project");
  await writeFile(join(project.commandsDir, "pr.md"), "$0|$1|$2|$ARGUMENTS[1]");
  const harness = commandHarness();
  try {
    registerClaudeCommandsForProject(harness.pi, project, new Set(), createClaudeProjectResolver());
    await harness.commands.get("pr")?.handler("\\$1 \"\" '$&'", harness.ctx(project.root));
    assert.equal(harness.messages.length, 1);
    assert.match(harness.messages[0], /\n\$1\|\|\$&\|$/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("nested commands dispatch only the invoking project's command file", async () => {
  const parent = await mkdtemp(join(tmpdir(), "claude-command-project-boundary-"));
  const first = await makeProject(parent, "first");
  const second = await makeProject(parent, "second");
  const empty = await makeProject(parent, "empty");
  await mkdir(join(first.commandsDir, "reviews"));
  await mkdir(join(second.commandsDir, "reviews"));
  await writeFile(join(first.commandsDir, "reviews", "check.md"), "FIRST PROJECT CONTENT");
  await writeFile(join(second.commandsDir, "reviews", "check.md"), "SECOND PROJECT CONTENT");
  const harness = commandHarness();
  try {
    registerClaudeCommandsForProject(harness.pi, first, new Set(), createClaudeProjectResolver());
    await harness.commands.get("reviews:check")?.handler("", harness.ctx(second.root));
    assert.equal(harness.messages.length, 1);
    assert.match(harness.messages[0], /SECOND PROJECT CONTENT/);
    assert.doesNotMatch(harness.messages[0], /FIRST PROJECT CONTENT/);
    await harness.commands.get("reviews:check")?.handler("", harness.ctx(empty.root));
    assert.equal(harness.messages.length, 1);
    assert.match(harness.notifications[0], /No \.claude command found/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("skips command-name collisions deterministically and reports unsupported names", async () => {
  const parent = await mkdtemp(join(tmpdir(), "claude-command-collisions-"));
  const project = await makeProject(parent, "project");
  await mkdir(join(project.commandsDir, "reviews"));
  await writeFile(join(project.commandsDir, "revisar-prs.md"), "must not replace external command");
  await writeFile(join(project.commandsDir, "compact.md"), "reserved alias");
  await writeFile(join(project.commandsDir, "bad name.md"), "invalid command");
  await writeFile(join(project.commandsDir, "reviews", "check.md"), "first collision");
  await writeFile(join(project.commandsDir, "reviews:check.md"), "second collision");
  const harness = commandHarness(["revisar-prs"]);
  const diagnostics: string[] = [];
  try {
    registerClaudeCommandsForProject(harness.pi, project, new Set(), createClaudeProjectResolver(), (message) => diagnostics.push(message));
    assert.deepEqual([...harness.commands.keys()], ["sipos-compact", "reviews:check"]);
    assert.equal(diagnostics.filter((message) => message.includes("reviews:check") && message.includes("collides")).length, 1);
    assert.ok(diagnostics.some((message) => message.includes("bad name.md") && message.includes("invalid")));
    assert.ok(diagnostics.some((message) => message.includes("revisar-prs") && message.includes("collides")));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("file errors and unsupported executable frontmatter never send a command prompt", async () => {
  const parent = await mkdtemp(join(tmpdir(), "claude-command-errors-"));
  const project = await makeProject(parent, "project");
  await writeFile(join(project.commandsDir, "malformed.md"), "---\ndescription: broken\nNo closing delimiter");
  await writeFile(join(project.commandsDir, "oversized.md"), "x".repeat(120_001));
  await writeFile(join(project.commandsDir, "shell.md"), "Run !`echo unsafe` now.");
  await writeFile(join(project.commandsDir, "permissions.md"), "---\nallowed-tools: Bash\n---\nRun a command.");
  await writeFile(join(project.commandsDir, "forked.md"), "---\ncontext: fork\nagent: Explore\n---\nRun a fork.");
  await writeFile(join(project.commandsDir, "hidden.md"), "---\nuser-invocable: false\n---\nRun hidden work.");
  await writeFile(join(project.commandsDir, "hooks.md"), "---\nhooks: {}\n---\nRun hooked work.");
  const harness = commandHarness();
  try {
    registerClaudeCommandsForProject(harness.pi, project, new Set(), createClaudeProjectResolver());
    for (const name of ["malformed", "oversized", "shell", "permissions", "forked", "hidden", "hooks"]) {
      await harness.commands.get(name)?.handler("", harness.ctx(project.root));
    }
    assert.equal(harness.messages.length, 0);
    assert.equal(harness.notifications.length, 7);
    assert.ok(harness.notifications.some((message) => message.includes("frontmatter is not terminated")));
    assert.ok(harness.notifications.some((message) => message.includes("size limit")));
    assert.ok(harness.notifications.some((message) => message.includes("shell injection") && message.includes("no shell was executed")));
    assert.ok(harness.notifications.some((message) => message.includes("allowed-tools") && message.includes("not supported")));
    assert.ok(harness.notifications.some((message) => message.includes("context") && message.includes("not supported")));
    assert.ok(harness.notifications.some((message) => message.includes("user-invocable: false") && message.includes("not supported")));
    assert.ok(harness.notifications.some((message) => message.includes("hooks") && message.includes("not supported")));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
