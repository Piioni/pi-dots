import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";

const { default: registerAdapter } = await import(new URL("../src/index.ts", import.meta.url).href);

type RegisteredTool = ToolDefinition & { execute: (...args: any[]) => Promise<any> };
function register(root?: string) {
  const tools = new Map<string, RegisteredTool>();
  const handlers = new Map<string, (event: any, ctx: any) => Promise<any> | any>();
  const pi = {
    on(name: string, handler: (event: any, ctx: any) => Promise<any> | any) { handlers.set(name, handler); },
    registerTool(tool: RegisteredTool) { tools.set(tool.name, tool); },
    registerCommand() {},
    sendUserMessage() {},
  } as unknown as ExtensionAPI;
  registerAdapter(pi);
  return { tools, handlers };
}

function writeAgent(root: string, name: string, frontmatter: string): Promise<void> {
  return writeFile(join(root, ".claude", "agents", `${name}.md`), `---\n${frontmatter}\n---\nAgent instructions.`);
}

test("registers callable list/run tools and rediscovers only the current trusted project agents", async () => {
  const parent = await mkdtemp(join(tmpdir(), "claude-agents-boundary-"));
  try {
    const first = join(parent, "first");
    const second = join(parent, "second");
    for (const root of [first, second]) await mkdir(join(root, ".git"), { recursive: true });
    await mkdir(join(first, ".claude", "agents"), { recursive: true });
    await mkdir(join(second, ".claude", "agents"), { recursive: true });
    await writeAgent(first, "review-one", "name: review-one\ndescription: First project reviewer.\ntools: Read, Grep, Glob, Bash\nmodel: sonnet");
    await writeAgent(first, "no-tools", "name: no-tools\ndescription: Explicitly has no tools.\ntools: []\nmodel: haiku");
    await writeAgent(second, "review-two", "name: review-two\ndescription: Second project reviewer.\ntools: Read, Grep, Glob, Bash, PowerShell, ToolSearch\nmodel: opus");
    const { tools } = register();
    const list = tools.get("claude_agent_list");
    const run = tools.get("claude_agent_run");
    assert.ok(list, "the adapter must register a model-callable agent catalog");
    assert.ok(run, "the adapter must register actual named-agent execution");
    const context = (cwd: string, trusted: boolean) => ({ cwd, isProjectTrusted: () => trusted, ui: { notify() {} } });
    const firstList = await list.execute("list-1", {}, undefined, undefined, context(first, true));
    assert.match(JSON.stringify(firstList), /review-one/);
    assert.match(JSON.stringify(firstList), /First project reviewer/);
    assert.match(JSON.stringify(firstList), /Agent instructions/);
    assert.match(JSON.stringify(firstList), /no-tools/);
    assert.match(JSON.stringify(firstList), /pending T4b/);
    const listed = JSON.parse(firstList.content[0].text);
    assert.deepEqual(listed.agents.find((agent: { name: string }) => agent.name === "no-tools").tools, []);
    assert.doesNotMatch(JSON.stringify(firstList), /review-two/);
    const untrusted = await list.execute("list-2", {}, undefined, undefined, context(second, false));
    assert.doesNotMatch(JSON.stringify(untrusted), /review-two/);
    const secondList = await list.execute("list-3", {}, undefined, undefined, context(second, true));
    assert.match(JSON.stringify(secondList), /review-two/);
    const mapped = JSON.parse(secondList.content[0].text).agents[0];
    assert.deepEqual(mapped.tools, ["read", "grep", "find", "bash", "powershell", "tool_search"]);
    assert.doesNotMatch(JSON.stringify(secondList), /review-one/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("refuses unavailable tools and absent active model before starting an agent prompt", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-agents-preflight-"));
  try {
    await mkdir(join(root, ".git"));
    await mkdir(join(root, ".claude", "agents"), { recursive: true });
    await writeAgent(root, "unknown-tool", "name: unknown-tool\ndescription: Uses an unsupported tool.\ntools: Read, NotARealTool\nmodel: haiku");
    await writeAgent(root, "valid-agent", "name: valid-agent\ndescription: A valid agent.\ntools: Read, Grep, Glob, Bash\nmodel: opus");
    await writeAgent(root, "missing-restriction", "name: missing-restriction\ndescription: Missing allowlist.");
    await writeAgent(root, "invalid-restriction", "name: invalid-restriction\ndescription: Invalid allowlist.\ntools: ,,");
    const registered = register();
    const run = registered.tools.get("claude_agent_run");
    assert.ok(run, "the adapter must register actual named-agent execution");
    const context = { cwd: root, isProjectTrusted: () => true, model: undefined, ui: { notify() {} } };
    const list = registered.tools.get("claude_agent_list");
    assert.ok(list);
    const listed = await list.execute("restrictions", {}, undefined, undefined, context);
    assert.match(listed.content[0].text, /missing tools restriction/);
    assert.match(listed.content[0].text, /invalid tools restriction/);
    await assert.rejects(run.execute("bad-tools", { name: "unknown-tool", task: "inspect" }, undefined, undefined, context), /NotARealTool/);
    await assert.rejects(run.execute("no-model", { name: "valid-agent", task: "inspect" }, undefined, undefined, context), /active Pi model/i);
    await assert.rejects(run.execute("unknown-agent", { name: "missing", task: "inspect" }, undefined, undefined, context), /missing|not found|unknown/i);
    await assert.rejects(run.execute("missing-tools", { name: "missing-restriction", task: "inspect" }, undefined, undefined, context), /missing tools restriction/);
    await assert.rejects(run.execute("invalid-tools", { name: "invalid-restriction", task: "inspect" }, undefined, undefined, context), /invalid tools restriction/);
    await assert.rejects(run.execute("invalid-task", { name: "valid-agent", task: "  " }, undefined, undefined, context), /non-empty task/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(run.execute("cancelled", { name: "valid-agent", task: "inspect" }, controller.signal, undefined, context), /cancelled/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
