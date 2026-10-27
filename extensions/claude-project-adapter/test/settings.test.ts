import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { loadClaudeSettings } = await import(new URL("../src/settings.ts", import.meta.url).href) as {
  loadClaudeSettings: (claudeDir: string) => { settings: Record<string, unknown>; diagnostics: string[] };
};

async function withProject(run: (claudeDir: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "claude-settings-"));
  const claudeDir = join(root, ".claude");
  await mkdir(claudeDir);
  try {
    await run(claudeDir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("ignores local settings values, hooks, and diagnostics", async () => {
  await withProject(async (claudeDir) => {
    await writeFile(join(claudeDir, "settings.json"), JSON.stringify({
      permissions: { additionalDirectories: ["/outside"], deny: ["Bash"] },
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "safe-test-command" }] }] },
      customSetting: true,
      fallbackModel: ["shared-model"],
    }));
    await writeFile(join(claudeDir, "settings.local.json"), JSON.stringify({
      customSetting: false,
      fallbackModel: ["local-model"],
      hooks: {
        PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "local-test-command" }] }],
        Stop: [{ hooks: [{ type: "command", command: "unexecuted" }] }],
      },
    }));

    const result = loadClaudeSettings(claudeDir);
    assert.equal(result.settings.customSetting, true);
    assert.deepEqual(result.settings.fallbackModel, ["shared-model"]);
    const hooks = result.settings.hooks as Record<string, unknown>;
    assert.equal((hooks.PreToolUse as unknown[]).length, 1);
    assert.equal(Object.hasOwn(hooks, "Stop"), false);
    assert.equal(result.diagnostics.some((message) => message.includes("additionalDirectories")), false);
    assert.ok(result.diagnostics.some((message) => message.includes("Other Claude permission settings")));
    assert.equal(result.diagnostics.some((message) => message.includes("Stop")), false);
    assert.ok(result.diagnostics.some((message) => message.includes("fallbackModel")));
    assert.equal(result.diagnostics.some((message) => message.includes("/outside")), false);
    assert.equal(result.diagnostics.some((message) => message.includes("safe-test-command")), false);
    assert.equal(result.diagnostics.some((message) => message.includes("local-test-command")), false);
  });
});

test("rejects malformed and oversized settings with value-free diagnostics", async () => {
  await withProject(async (claudeDir) => {
    const path = join(claudeDir, "settings.json");
    await writeFile(path, '{"privateValue":"do-not-print"');
    let result = loadClaudeSettings(claudeDir);
    assert.equal(Object.keys(result.settings).length, 0);
    assert.ok(result.diagnostics.some((message) => message.includes("settings.json") && message.includes("invalid JSON")));
    assert.equal(result.diagnostics.join(" ").includes("do-not-print"), false);

    await writeFile(path, " ".repeat(300_000));
    result = loadClaudeSettings(claudeDir);
    assert.equal(Object.keys(result.settings).length, 0);
    assert.ok(result.diagnostics.some((message) => message.includes("size limit")));
  });
});

test("does not inherit hooks from hostile shared JSON prototype keys", async () => {
  await withProject(async (claudeDir) => {
    await writeFile(
      join(claudeDir, "settings.json"),
      '{"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"safe-shared"}]}],"__proto__":{"PreToolUse":[{"hooks":[{"type":"command","command":"never-run"}]}]}}}',
    );
    let result = loadClaudeSettings(claudeDir);
    assert.equal(((result.settings.hooks as Record<string, unknown>).PreToolUse as unknown[]).length, 1);
    assert.equal(Object.getPrototypeOf(result.settings.hooks), null);

    await writeFile(
      join(claudeDir, "settings.json"),
      '{"__proto__":{"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"never-run"}]}]}}}',
    );
    result = loadClaudeSettings(claudeDir);
    assert.equal(Object.hasOwn(result.settings, "hooks"), false);
    assert.equal(Object.getPrototypeOf(result.settings), null);
  });
});

test("bounds diagnostic bytes and suppresses arbitrary setting, event, and type text", async () => {
  await withProject(async (claudeDir) => {
    const secret = "DO_NOT_DISPLAY";
    const hostileName = `${"N".repeat(20_000)}\n${secret}\u0001`;
    const config: Record<string, unknown> = { [hostileName]: true };
    for (const key of [
      "model", "fallbackModel", "modelPicker", "modelSettings", "availableModels", "env",
      "enabledPlugins", "extraKnownMarketplaces", "statusLine", "outputStyle", "plansDirectory",
      "cleanupPeriodDays", "language", "sandbox", "attribution",
    ]) config[key] = true;
    config.hooks = Object.fromEntries([
      "PostToolUse", "PostToolUseFailure", "Notification", "UserPromptSubmit", "SessionStart",
      "SessionEnd", "Stop", "SubagentStart", "SubagentStop", "PreCompact", "PermissionRequest",
      "Setup", "TeammateIdle", "TaskCompleted", "ConfigChange", "WorktreeCreate", "WorktreeRemove",
      hostileName,
    ].map((event) => [event, []]));
    (config.hooks as Record<string, unknown>).PreToolUse = [{ hooks: [{ type: hostileName }] }];
    const settings = JSON.stringify(config);
    await writeFile(join(claudeDir, "settings.json"), settings);
    const diagnostics = loadClaudeSettings(claudeDir).diagnostics;
    const output = diagnostics.join(" ");
    assert.ok(diagnostics.length <= 20);
    assert.ok(diagnostics.every((message) => Buffer.byteLength(message) <= 256));
    assert.ok(Buffer.byteLength(output) <= 4_096);
    assert.equal(output.includes(secret), false);
    assert.equal(output.includes("N".repeat(100)), false);
    assert.match(output, /suppressed/);
    assert.doesNotMatch(output, /[\x00-\x1f\x7f-\x9f]/);
  });
});

test("reports unsupported hook types and event names without exposing commands", async () => {
  await withProject(async (claudeDir) => {
    await writeFile(join(claudeDir, "settings.json"), JSON.stringify({
      hooks: {
        PreToolUse: [{ hooks: [{ type: "prompt", prompt: "private prompt" }] }],
        WorktreeCreate: [{ hooks: [{ type: "command", command: "private command" }] }],
      },
    }));
    const result = loadClaudeSettings(claudeDir);
    const diagnostics = result.diagnostics.join(" ");
    assert.match(diagnostics, /prompt/);
    assert.match(diagnostics, /WorktreeCreate/);
    assert.doesNotMatch(diagnostics, /private/);
    assert.match(diagnostics, /PreToolUse/);
  });
});
