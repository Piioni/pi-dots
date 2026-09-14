import assert from "node:assert/strict";
import test from "node:test";
import {
  AssistantSourceRegistry,
  copyCodeBlock,
  describeCodeBlock,
  findLatestAssistantMessage,
  runCopyCodeCommand,
} from "./code-copy.ts";
import { extractAssistantCodeBlocks } from "./code-blocks.ts";

const assistant = (text: string) => ({ role: "assistant" as const, content: [{ type: "text" as const, text }] });
const complete = assistant("```ts\nconst copied = '\\x1b[31m';\n```");

function dependencies(overrides: Partial<Parameters<typeof runCopyCodeCommand>[1]> = {}) {
  const writes: string[] = [];
  const notifications: Array<{ message: string; type: string | undefined }> = [];
  let generation = 1;
  return {
    writes,
    notifications,
    setGeneration: (next: number) => { generation = next; },
    deps: {
      source: new AssistantSourceRegistry(),
      getLatestAssistant: () => complete,
      write: async (text: string) => { writes.push(text); },
      notify: (message: string, type?: "info" | "warning" | "error") => notifications.push({ message, type }),
      select: async () => 1,
      getGeneration: () => generation,
      ...overrides,
    },
  };
}

test("copies one exact raw payload directly after the clipboard writer resolves", async () => {
  const { deps, writes, notifications } = dependencies();
  await runCopyCodeCommand("", deps);

  assert.deepEqual(writes, ["const copied = '\\x1b[31m';"]);
  assert.deepEqual(notifications, [{ message: "Copied code block 1.", type: "info" }]);
});

test("selects deterministic block labels and supports direct positive ordinals", async () => {
  const message = assistant("```js\nfirst()\n```\n~~~py\nsecond()\n~~~");
  const seen: ReturnType<typeof describeCodeBlock>[] = [];
  const { deps, writes } = dependencies({
    getLatestAssistant: () => message,
    select: async (blocks) => {
      seen.push(...blocks.map(describeCodeBlock));
      return 2;
    },
  });

  await runCopyCodeCommand("", deps);
  assert.deepEqual(seen, [
    { label: "Block 1", description: "js — first()" },
    { label: "Block 2", description: "py — second()" },
  ]);
  assert.deepEqual(writes, ["second()"]);

  await runCopyCodeCommand("1", deps);
  assert.deepEqual(writes, ["second()", "first()"]);
});

test("rejects invalid, out-of-range, no-code, and cancellation paths without writing", async () => {
  const { deps, writes, notifications } = dependencies({
    getLatestAssistant: () => assistant("text only"),
  });
  await runCopyCodeCommand("2", deps);
  await runCopyCodeCommand("", deps);
  assert.deepEqual(writes, []);
  assert.deepEqual(notifications.map(({ message }) => message), [
    "No complete fenced code blocks in the latest assistant message.",
    "No complete fenced code blocks in the latest assistant message.",
  ]);

  const invalid = dependencies();
  await runCopyCodeCommand("banana", invalid.deps);
  await runCopyCodeCommand("2", invalid.deps);
  assert.deepEqual(invalid.writes, []);
  assert.deepEqual(invalid.notifications.map(({ message }) => message), [
    "Usage: /copy-code [number]",
    "Code block 2 is not available.",
  ]);

  const cancelled = dependencies({
    getLatestAssistant: () => assistant("```\none\n```\n```\ntwo\n```"),
    select: async () => undefined,
  });
  await runCopyCodeCommand("", cancelled.deps);
  assert.deepEqual(cancelled.writes, []);
  assert.deepEqual(cancelled.notifications, []);
});

test("reports clipboard success only after settlement and reports rejection only as failure", async () => {
  let resolve!: () => void;
  const pending = new Promise<void>((done) => { resolve = done; });
  const { deps, notifications } = dependencies({ write: async () => pending });
  const operation = runCopyCodeCommand("", deps);
  assert.deepEqual(notifications, []);
  resolve();
  await operation;
  assert.deepEqual(notifications, [{ message: "Copied code block 1.", type: "info" }]);

  const rejected = dependencies({ write: async () => { throw new Error("clipboard unavailable"); } });
  await runCopyCodeCommand("", rejected.deps);
  assert.deepEqual(rejected.writes, []);
  assert.deepEqual(rejected.notifications, [{ message: "Unable to copy code block 1.", type: "error" }]);
});

test("suppresses duplicate pending copies and stale async notifications", async () => {
  const block = extractAssistantCodeBlocks(complete)[0]!;
  const pending = new Set<string>();
  let resolve!: () => void;
  const write = new Promise<void>((done) => { resolve = done; });
  let writes = 0;
  let generation = 1;
  const notifications: string[] = [];
  const deps = {
    write: async () => { writes += 1; await write; },
    notify: (message: string) => notifications.push(message),
    getGeneration: () => generation,
    pending,
  };

  const first = copyCodeBlock(block, deps);
  const duplicate = copyCodeBlock(block, deps);
  assert.equal(writes, 1);
  assert.deepEqual(await duplicate, { ok: false, skipped: true });
  generation = 2;
  resolve();
  assert.deepEqual(await first, { ok: true });
  assert.deepEqual(notifications, []);
});

test("prefers the current streaming snapshot and never falls back to an older assistant", async () => {
  const source = new AssistantSourceRegistry();
  source.set(assistant("```ts\npartial"));
  const { deps, writes, notifications } = dependencies({ source, getLatestAssistant: () => complete });

  await runCopyCodeCommand("", deps);
  assert.deepEqual(writes, []);
  assert.deepEqual(notifications, [{ message: "No complete fenced code blocks in the latest assistant message.", type: "info" }]);

  source.clear();
  await runCopyCodeCommand("", deps);
  assert.deepEqual(writes, ["const copied = '\\x1b[31m';"]);
});

test("resolves only the latest assistant on the current branch", () => {
  const older = { type: "message" as const, message: complete };
  const latestWithoutCode = { type: "message" as const, message: assistant("latest plain text") };
  const current = findLatestAssistantMessage([older, latestWithoutCode]);
  assert.strictEqual(current, latestWithoutCode.message);
  assert.equal(findLatestAssistantMessage([{ type: "message" as const, message: { role: "user", content: "ignored", timestamp: 0 } }]), undefined);
});
