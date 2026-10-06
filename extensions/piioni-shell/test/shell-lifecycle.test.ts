import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { ExtensionAPI, ExtensionContext, ToolInfo } from "@earendil-works/pi-coding-agent";
import piioniShell from "../src/index.ts";

interface ExecCall { command: string; args: string[]; root: string; }
type Handler = (event: any, ctx: any) => unknown;

function createShellFixture(watchValue: string | null = "off") {
  const events = new Map<string, Handler>();
  const commands = new Map<string, { handler: (...args: any[]) => unknown }>();
  const calls: ExecCall[] = [];
  let tools: ToolInfo[] = [];
  let statusOutput = "";
  let execGate: Promise<void> | undefined;
  const previousWatch = process.env.PIIONI_SHELL_CHANGES_WATCH_MS;
  const context = (cwd: string) => ({
    cwd,
    hasUI: true,
    mode: "tui",
    model: { provider: "fixture-provider" },
    ui: {
      setFooter() {},
      setWidget() {},
      setWorkingMessage() {},
      setWorkingVisible() {},
      getEditorComponent: () => undefined,
      setEditorComponent() {},
      notify() {},
      async custom() { return undefined; },
    },
  }) as unknown as ExtensionContext;
  const pi = {
    registerCommand(name: string, command: { handler: (...args: any[]) => unknown }) { commands.set(name, command); },
    registerShortcut() {},
    on(name: string, handler: Handler) { events.set(name, handler); return () => events.delete(name); },
    getAllTools: () => tools,
    async exec(command: string, args: string[]) {
      calls.push({ command, args, root: args[1] ?? "" });
      const gate = execGate;
      if (gate) await gate;
      return { stdout: args.includes("status") ? statusOutput : "", stderr: "", code: 0 };
    },
  } as unknown as ExtensionAPI;

  if (watchValue === null) delete process.env.PIIONI_SHELL_CHANGES_WATCH_MS;
  else process.env.PIIONI_SHELL_CHANGES_WATCH_MS = watchValue;
  piioniShell(pi);

  return {
    calls,
    commands,
    context,
    setTools(next: ToolInfo[]) { tools = next; },
    setStatusOutput(next: string) { statusOutput = next; },
    setExecGate(next: Promise<void> | undefined) { execGate = next; },
    async emit(name: string, event: object = {}) {
      const handler = events.get(name);
      assert.ok(handler, `extension registered ${name}`);
      return await handler(event, context("/unused"));
    },
    async startWithoutWaiting(ctx: ExtensionContext) {
      const handler = events.get("session_start");
      assert.ok(handler);
      await handler({}, ctx);
    },
    async start(ctx: ExtensionContext) {
      await this.startWithoutWaiting(ctx);
      await waitFor(() => calls.length >= 2);
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
    async shutdown(ctx: ExtensionContext) {
      const handler = events.get("session_shutdown");
      assert.ok(handler);
      await handler({}, ctx);
    },
    async settle(ctx: ExtensionContext) {
      const handler = events.get("agent_settled");
      assert.ok(handler);
      await handler({}, ctx);
    },
    async agentStart(ctx: ExtensionContext) {
      const handler = events.get("agent_start");
      assert.ok(handler);
      await handler({}, ctx);
    },
    dispose() {
      if (previousWatch === undefined) delete process.env.PIIONI_SHELL_CHANGES_WATCH_MS;
      else process.env.PIIONI_SHELL_CHANGES_WATCH_MS = previousWatch;
    },
    async tool(toolName: string, ctx: ExtensionContext) {
      const handler = events.get("tool_execution_end");
      assert.ok(handler);
      return await handler({ toolName, toolCallId: `call-${toolName}`, result: {}, isError: false }, ctx);
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for the extension observer");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function advanceTimers(context: TestContext, milliseconds: number): Promise<void> {
  context.mock.timers.tick(milliseconds);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await Promise.resolve();
  await Promise.resolve();
}

function enableFakeTimers(context: TestContext): void {
  context.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
}

const codexToken = (accountId = "fixture-account") => `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } })).toString("base64url")}.signature`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function codexContext(fixture: Awaited<ReturnType<typeof startedFixture>>) {
  const ctx = fixture.ctx as any;
  ctx.model = { provider: "openai-codex" };
  ctx.modelRegistry = { getApiKeyForProvider: async () => codexToken() };
  return ctx;
}

const toolInfo = (name: string, annotations?: ToolInfo["annotations"]) => ({
  name,
  description: name,
  parameters: {},
  exposure: "direct" as const,
  annotations,
  sourceInfo: {} as ToolInfo["sourceInfo"],
}) as ToolInfo;

async function startedFixture(root = "/repo/one", watchValue: string | null = "off") {
  const fixture = createShellFixture(watchValue);
  const ctx = fixture.context(root);
  await fixture.start(ctx);
  fixture.calls.length = 0;
  return { ...fixture, ctx };
}

test("initial Codex refresh and simultaneous forced commands share one fetch", async () => {
  const fixture = createShellFixture();
  const ctx = fixture.context("/repo/usage") as any;
  ctx.model = { provider: "openai-codex" };
  ctx.modelRegistry = { getApiKeyForProvider: async () => codexToken() };
  const previousFetch = globalThis.fetch;
  let fetches = 0;
  const transport = deferred<Response>();
  globalThis.fetch = (async (_input: any, init?: RequestInit) => {
    fetches += 1;
    assert.ok(init?.signal instanceof AbortSignal);
    return transport.promise;
  }) as typeof fetch;
  try {
    await fixture.start(ctx);
    await waitFor(() => fetches === 1);
    const command = fixture.commands.get("gentle:usage");
    assert.ok(command);
    const forcedA = command.handler("", { ...ctx, mode: "rpc" } as any);
    const forcedB = command.handler("", { ...ctx, mode: "rpc" } as any);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fetches, 1, "all callers join the session's in-flight request");
    transport.resolve(new Response(JSON.stringify({}), { status: 200 }));
    await Promise.all([forcedA, forcedB]);
    assert.equal(fetches, 1);
  } finally {
    globalThis.fetch = previousFetch;
    await fixture.shutdown(ctx);
    fixture.dispose();
  }
});

test("usage deadline aborts transport, releases callers, and permits a forced retry", async (t) => {
  const fixture = await startedFixture();
  enableFakeTimers(t);
  const ctx = codexContext(fixture);
  const previousFetch = globalThis.fetch;
  let fetches = 0;
  let firstSignal: AbortSignal | undefined;
  globalThis.fetch = (async (_input: any, init?: RequestInit) => {
    fetches += 1;
    if (fetches === 1) {
      firstSignal = init?.signal as AbortSignal;
      return await new Promise<Response>(() => {});
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }) as typeof fetch;
  try {
    const command = fixture.commands.get("gentle:usage");
    assert.ok(command);
    const pending = command.handler("", { ...ctx, mode: "rpc" } as any);
    for (let turn = 0; turn < 8 && fetches === 0; turn += 1) await Promise.resolve();
    assert.equal(fetches, 1, "Codex credentials should reach the controlled transport");
    await advanceTimers(t, 10_000);
    await pending;
    assert.equal(firstSignal?.aborted, true);
    await command.handler("", { ...ctx, mode: "rpc" } as any);
    assert.equal(fetches, 2, "explicit force retries after timed-out request");
  } finally {
    globalThis.fetch = previousFetch;
    await fixture.shutdown(fixture.ctx);
    fixture.dispose();
  }
});

test("session shutdown cancels an old usage response without affecting a newer request", async () => {
  const fixture = await startedFixture();
  const oldCtx = codexContext(fixture);
  const previousFetch = globalThis.fetch;
  const responses: Array<ReturnType<typeof deferred<Response>>> = [];
  const signals: AbortSignal[] = [];
  globalThis.fetch = (async (_input: any, init?: RequestInit) => {
    signals.push(init?.signal as AbortSignal);
    const response = deferred<Response>();
    responses.push(response);
    return response.promise;
  }) as typeof fetch;
  try {
    const command = fixture.commands.get("gentle:usage");
    assert.ok(command);
    const oldCommand = command.handler("", { ...oldCtx, mode: "rpc" } as any);
    await waitFor(() => responses.length === 1);
    await fixture.shutdown(oldCtx);
    const newCtx = fixture.context("/repo/new-session") as any;
    newCtx.model = { provider: "openai-codex" };
    newCtx.modelRegistry = { getApiKeyForProvider: async () => codexToken() };
    await fixture.start(newCtx);
    const newCommand = command.handler("", { ...newCtx, mode: "rpc" } as any);
    await waitFor(() => responses.length === 2);
    assert.equal(signals[0].aborted, true);
    responses[0].resolve(new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: 91 } } }), { status: 200 }));
    await oldCommand;
    const overlappingForce = command.handler("", { ...newCtx, mode: "rpc" } as any);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(responses.length, 2, "the old request's completion must not clear the newer in-flight owner");
    responses[1].resolve(new Response(JSON.stringify({}), { status: 200 }));
    await Promise.all([newCommand, overlappingForce]);
  } finally {
    globalThis.fetch = previousFetch;
    await fixture.shutdown(fixture.context("/repo/new-session"));
    fixture.dispose();
  }
});

test("credentials that outlive the deadline cannot start a late fetch", async (t) => {
  const fixture = await startedFixture();
  enableFakeTimers(t);
  const ctx = codexContext(fixture);
  const credentials = deferred<string | undefined>();
  ctx.modelRegistry = { getApiKeyForProvider: () => credentials.promise };
  const previousFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => { fetches += 1; return new Response("{}", { status: 200 }); }) as typeof fetch;
  try {
    const command = fixture.commands.get("gentle:usage");
    assert.ok(command);
    const pending = command.handler("", { ...ctx, mode: "rpc" } as any);
    await Promise.resolve();
    await advanceTimers(t, 10_000);
    await pending;
    credentials.resolve(codexToken());
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fetches, 0, "late credential completion is gated before network access");
  } finally {
    globalThis.fetch = previousFetch;
    await fixture.shutdown(fixture.ctx);
    fixture.dispose();
  }
});

test("non-Codex usage commands do not fetch and ordinary Codex refresh honors five-minute throttle", async () => {
  const fixture = await startedFixture();
  const ctx = codexContext(fixture);
  const previousFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => { fetches += 1; return new Response("{}", { status: 200 }); }) as typeof fetch;
  try {
    const command = fixture.commands.get("gentle:usage");
    assert.ok(command);
    await command.handler("", { ...ctx, model: { provider: "fixture-provider" }, mode: "rpc" } as any);
    assert.equal(fetches, 0);
    await fixture.settle(ctx);
    await fixture.settle(ctx);
    assert.equal(fetches, 1, "the normal automatic path retains its five-minute attempt throttle");
  } finally {
    globalThis.fetch = previousFetch;
    await fixture.shutdown(fixture.ctx);
    fixture.dispose();
  }
});

test("agent settlement from a replaced session never uses its old provider credentials", async (t) => {
  const fixture = await startedFixture("/repo/old-settlement");
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"] });
  t.mock.timers.setTime(600_000);
  const oldCtx = fixture.ctx as any;
  const credentials = { calls: 0 };
  oldCtx.model = { provider: "openai-codex" };
  oldCtx.modelRegistry = { getApiKeyForProvider: async () => { credentials.calls += 1; return codexToken("old-account"); } };
  fixture.calls.length = 0;
  const gate = deferred<void>();
  fixture.setExecGate(gate.promise);
  const settlement = fixture.settle(oldCtx);
  await waitFor(() => fixture.calls.length === 2);

  try {
    await fixture.shutdown(oldCtx);
    fixture.setExecGate(undefined);
    const newCtx = fixture.context("/repo/new-settlement") as any;
    newCtx.model = { provider: "different-provider" };
    newCtx.modelRegistry = { getApiKeyForProvider: async () => { throw new Error("new provider has no Codex credentials"); } };
    await fixture.start(newCtx);
    fixture.calls.length = 0;

    const previousFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = (async () => { fetches += 1; return new Response("{}", { status: 200 }); }) as typeof fetch;
    try {
      gate.resolve();
      await settlement;
      assert.equal(credentials.calls, 0, "stale continuation must not query the old context's credential registry");
      assert.equal(fetches, 0, "the non-Codex replacement has no legitimate usage request");
    } finally {
      globalThis.fetch = previousFetch;
    }
  } finally {
    gate.resolve();
    await fixture.shutdown(fixture.context("/repo/new-settlement"));
    fixture.dispose();
  }
});

test("non-TUI startup does no Git, credential, or usage work", async () => {
  const previousFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => { fetches += 1; return new Response("{}", { status: 200 }); }) as typeof fetch;
  try {
    for (const mode of ["rpc", "json"] as const) {
      const fixture = createShellFixture();
      const ctx = fixture.context(`/repo/${mode}`) as any;
      ctx.mode = mode;
      ctx.hasUI = false;
      ctx.model = { provider: "openai-codex" };
      let credentials = 0;
      ctx.modelRegistry = { getApiKeyForProvider: async () => { credentials += 1; return codexToken(); } };
      try {
        await fixture.startWithoutWaiting(ctx);
        assert.equal(fixture.calls.length, 0, `${mode} startup must not run Git`);
        assert.equal(credentials, 0, `${mode} startup must not acquire credentials`);
        assert.equal(fetches, 0, `${mode} startup must not fetch usage`);
      } finally {
        await fixture.shutdown(ctx);
        fixture.dispose();
      }
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("transport errors release request state for force retry and completed timers stay inert", async (t) => {
  const fixture = await startedFixture();
  enableFakeTimers(t);
  const ctx = codexContext(fixture);
  const previousFetch = globalThis.fetch;
  const signals: AbortSignal[] = [];
  let fetches = 0;
  globalThis.fetch = (async (_input: any, init?: RequestInit) => {
    fetches += 1;
    signals.push(init?.signal as AbortSignal);
    if (fetches === 1) throw new Error("controlled transport failure");
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const command = fixture.commands.get("gentle:usage");
    assert.ok(command);
    await command.handler("", { ...ctx, mode: "rpc" } as any);
    assert.equal(fetches, 1);
    await command.handler("", { ...ctx, mode: "rpc" } as any);
    assert.equal(fetches, 2, "a forced command retries after a transport error");
    await advanceTimers(t, 10_000);
    assert.equal(signals[0].aborted, false, "the failed request's deadline timer was disposed");
    assert.equal(signals[1].aborted, false, "the successful request's deadline timer was disposed");
  } finally {
    globalThis.fetch = previousFetch;
    await fixture.shutdown(fixture.ctx);
    fixture.dispose();
  }
});

test("tool completion returns while Git is blocked and in-flight bursts receive a trailing refresh", async () => {
  const fixture = await startedFixture();
  try {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    fixture.setExecGate(gate);

    let hookReturned = false;
    const first = fixture.tool("mutating", fixture.ctx).then(() => { hookReturned = true; });
    await first;
    assert.equal(hookReturned, true, "tool completion must not await the Git refresh");
    await waitFor(() => fixture.calls.length === 2);

    await fixture.tool("unknown-during-refresh", fixture.ctx);
    const settlement = fixture.settle(fixture.ctx);
    await new Promise((resolve) => setTimeout(resolve, 220));
    assert.equal(fixture.calls.length, 2, "settlement should cancel the pending timer while Git remains blocked");

    fixture.setExecGate(undefined);
    release();
    await settlement;
    await waitFor(() => fixture.calls.length === 4);
  } finally {
    await fixture.shutdown(fixture.ctx);
    fixture.dispose();
  }
});

test("settlement supersedes a pending tool timer instead of issuing a second Git pair", async () => {
  const fixture = await startedFixture();
  try {
    await fixture.tool("mutation", fixture.ctx);
    await fixture.settle(fixture.ctx);
    assert.equal(fixture.calls.length, 2, "settlement should perform one immediate Git pair");
    await new Promise((resolve) => setTimeout(resolve, 220));
    assert.equal(fixture.calls.length, 2, "the superseded completion timer must not perform another Git pair");
  } finally {
    await fixture.shutdown(fixture.ctx);
    fixture.dispose();
  }
});

test("tool completion bursts share one bounded refresh window", async () => {
  const fixture = await startedFixture();
  try {
    await Promise.all(Array.from({ length: 6 }, () => fixture.tool("unknown", fixture.ctx)));
    await waitFor(() => fixture.calls.length === 2);
    await new Promise((resolve) => setTimeout(resolve, 220));
    assert.equal(fixture.calls.length, 2, "one completion burst should issue one Git command pair");
  } finally {
    await fixture.shutdown(fixture.ctx);
    fixture.dispose();
  }
});

test("only explicitly read-only, non-destructive tools skip refresh", async () => {
  const fixture = await startedFixture();
  try {
    fixture.setTools([toolInfo("reader", { readOnlyHint: true }), toolInfo("conflicted", { readOnlyHint: true, destructiveHint: true })]);
    await fixture.tool("reader", fixture.ctx);
    await new Promise((resolve) => setTimeout(resolve, 220));
    assert.equal(fixture.calls.length, 0, "documented read-only completion should not refresh");

    await fixture.tool("conflicted", fixture.ctx);
    await waitFor(() => fixture.calls.length === 2);
    fixture.calls.length = 0;
    await fixture.tool("unregistered-tool", fixture.ctx);
    await waitFor(() => fixture.calls.length === 2);
  } finally {
    await fixture.shutdown(fixture.ctx);
    fixture.dispose();
  }
});

test("session replacement cancels delayed work and the manual command still reads Git immediately", async () => {
  const fixture = await startedFixture("/repo/old");
  try {
    await fixture.tool("unknown", fixture.ctx);
    await fixture.shutdown(fixture.ctx);
    const nextContext = fixture.context("/repo/new");
    await fixture.start(nextContext);
    await new Promise((resolve) => setTimeout(resolve, 220));
    assert.equal(fixture.calls.length, 2, "the canceled old-session timer must not refresh either root again");
    assert.deepEqual(fixture.calls.map(({ root }) => root), ["/repo/new", "/repo/new"]);

    fixture.calls.length = 0;
    const command = fixture.commands.get("gentle:changes");
    assert.ok(command);
    await command.handler("", nextContext);
    assert.deepEqual(fixture.calls.map(({ root }) => root), ["/repo/new", "/repo/new"], "manual view should issue a fresh Git pair without waiting for debounce");
  } finally {
    await fixture.shutdown(fixture.context("/repo/new"));
    fixture.dispose();
  }
});

test("default polling adapts between 30-second idle and 5-second active cadence", async (t) => {
  enableFakeTimers(t);
  const fixture = await startedFixture("/repo/adaptive", null);
  try {
    await advanceTimers(t, 29_999);
    assert.equal(fixture.calls.length, 0);
    await advanceTimers(t, 1);
    assert.equal(fixture.calls.length, 2, "idle poll runs at 30 seconds");

    fixture.calls.length = 0;
    await fixture.agentStart(fixture.ctx);
    await advanceTimers(t, 4_999);
    assert.equal(fixture.calls.length, 0);
    await advanceTimers(t, 1);
    assert.equal(fixture.calls.length, 2, "active poll runs at 5 seconds");

    fixture.calls.length = 0;
    await fixture.settle(fixture.ctx);
    assert.equal(fixture.calls.length, 2, "settlement keeps its immediate refresh");
    fixture.calls.length = 0;
    await advanceTimers(t, 29_999);
    assert.equal(fixture.calls.length, 0);
    await advanceTimers(t, 1);
    assert.equal(fixture.calls.length, 2, "settlement returns polling to the idle cadence");
  } finally {
    await fixture.shutdown(fixture.ctx);
    fixture.dispose();
  }
});

test("valid positive custom cadence is unchanged across activity transitions", async (t) => {
  enableFakeTimers(t);
  const fixture = await startedFixture("/repo/custom", "7200");
  try {
    await fixture.agentStart(fixture.ctx);
    await advanceTimers(t, 7_199);
    assert.equal(fixture.calls.length, 0);
    await advanceTimers(t, 1);
    assert.equal(fixture.calls.length, 2, "active work does not replace the explicit 7200 ms cadence");

    fixture.calls.length = 0;
    await fixture.settle(fixture.ctx);
    fixture.calls.length = 0;
    await advanceTimers(t, 7_199);
    assert.equal(fixture.calls.length, 0);
    await advanceTimers(t, 1);
    assert.equal(fixture.calls.length, 2, "settlement retains the explicit 7200 ms cadence");
  } finally {
    await fixture.shutdown(fixture.ctx);
    fixture.dispose();
  }
});

test("off and zero disable polling while invalid values use the adaptive idle default", async (t) => {
  enableFakeTimers(t);
  for (const value of ["off", "0"]) {
    const fixture = await startedFixture(`/repo/${value}`, value);
    try {
      await advanceTimers(t, 60_000);
      assert.equal(fixture.calls.length, 0, `${value} disables periodic refresh`);
    } finally {
      await fixture.shutdown(fixture.ctx);
      fixture.dispose();
    }
  }

  for (const value of [null, "invalid"]) {
    const fixture = await startedFixture(`/repo/${value ?? "unset"}`, value);
    try {
      await advanceTimers(t, 29_999);
      assert.equal(fixture.calls.length, 0, `${String(value)} uses the adaptive idle default`);
      await advanceTimers(t, 1);
      assert.equal(fixture.calls.length, 2);
    } finally {
      await fixture.shutdown(fixture.ctx);
      fixture.dispose();
    }
  }
});

test("blocked poll joins the active refresh without accumulating timer work", async (t) => {
  enableFakeTimers(t);
  const fixture = await startedFixture("/repo/blocked", null);
  try {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    fixture.setExecGate(gate);
    await fixture.agentStart(fixture.ctx);
    await advanceTimers(t, 5_000);
    assert.equal(fixture.calls.length, 2, "first active poll starts one Git pair");

    await advanceTimers(t, 60_000);
    assert.equal(fixture.calls.length, 2, "a blocked pass has no accumulating interval backlog");

    fixture.setExecGate(undefined);
    release();
    await advanceTimers(t, 0);
    await advanceTimers(t, 4_999);
    assert.equal(fixture.calls.length, 2);
    await advanceTimers(t, 1);
    assert.equal(fixture.calls.length, 4, "one next poll is scheduled after the blocked pass completes");
  } finally {
    await fixture.shutdown(fixture.ctx);
    fixture.dispose();
  }
});

test("polls rearmed by activity survive an awaited pass without stale timer resurrection", async (t) => {
  enableFakeTimers(t);
  const fixture = await startedFixture("/repo/rearm", null);
  try {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    fixture.setExecGate(gate);
    await advanceTimers(t, 30_000);
    assert.equal(fixture.calls.length, 2, "idle poll starts one blocked pass");

    await fixture.agentStart(fixture.ctx);
    fixture.setExecGate(undefined);
    release();
    await advanceTimers(t, 0);
    await advanceTimers(t, 4_999);
    assert.equal(fixture.calls.length, 2);
    await advanceTimers(t, 1);
    assert.equal(fixture.calls.length, 4, "activity rearm keeps exactly one active timer");
  } finally {
    await fixture.shutdown(fixture.ctx);
    fixture.dispose();
  }
});

test("shutdown and session replacement prevent an awaited old poll from rearming", async (t) => {
  enableFakeTimers(t);
  const fixture = await startedFixture("/repo/old-poll", "5000");
  try {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    fixture.setExecGate(gate);
    await advanceTimers(t, 5_000);
    assert.deepEqual(fixture.calls.map(({ root }) => root), ["/repo/old-poll", "/repo/old-poll"]);

    await fixture.shutdown(fixture.ctx);
    fixture.setExecGate(undefined);
    const nextContext = fixture.context("/repo/new-poll");
    await fixture.start(nextContext);
    release();
    await advanceTimers(t, 0);
    fixture.calls.length = 0;

    await advanceTimers(t, 4_999);
    assert.equal(fixture.calls.length, 0);
    await advanceTimers(t, 1);
    assert.deepEqual(fixture.calls.map(({ root }) => root), ["/repo/new-poll", "/repo/new-poll"]);
  } finally {
    await fixture.shutdown(fixture.context("/repo/new-poll"));
    fixture.dispose();
  }
});
