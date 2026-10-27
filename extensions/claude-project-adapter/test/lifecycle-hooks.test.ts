import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const { default: registerAdapter } = await import(new URL("../src/index.ts", import.meta.url).href);

function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
function nodeCommand(code: string): string { return `${shellQuote(process.execPath)} -e ${shellQuote(code)}`; }

async function waitForNotification(notifications: { message: string; type?: string }[], text: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (notifications.some(({ message }) => message.includes(text))) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for notification containing ${text}`);
}

async function waitForFile(path: string): Promise<string> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try { return await readFile(path, "utf8"); } catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function waitForMissingFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try { await readFile(path, "utf8"); await new Promise((resolve) => setTimeout(resolve, 10)); }
    catch { return; }
  }
  throw new Error(`Timed out waiting for ${path} cleanup`);
}

async function fixture(settings: unknown | ((root: string) => unknown)) {
  const root = await mkdtemp(join(tmpdir(), "claude-lifecycle-"));
  const project = join(root, "project");
  const piDir = join(root, "isolated-pi-agent");
  const claudeDir = join(project, ".claude");
  await Promise.all([mkdir(join(project, ".git"), { recursive: true }), mkdir(claudeDir, { recursive: true }), mkdir(piDir, { recursive: true })]);
  await writeFile(join(claudeDir, "settings.json"), JSON.stringify(typeof settings === "function" ? settings(root) : settings));
  const handlers = new Map<string, (event: any, ctx: any) => unknown>();
  const sent: any[] = [];
  const notifications: { message: string; type?: string }[] = [];
  let currentSession = "session-id";
  let currentCwd = project;
  let trusted = true;
  const pi = {
    on(event: string, handler: (event: any, ctx: any) => unknown) {
      const previous = handlers.get(event);
      handlers.set(event, previous ? async (event, ctx) => { await previous(event, ctx); return await handler(event, ctx); } : handler);
    },
    registerCommand() {}, registerTool() {}, sendMessage(message: unknown, options: unknown) { sent.push({ message, options }); },
  } as unknown as ExtensionAPI;
  registerAdapter(pi);
  const ctx = (cwd?: string, isTrusted?: boolean) => ({
    get cwd() { return cwd ?? currentCwd; },
    isProjectTrusted: () => isTrusted ?? trusted,
    sessionManager: { getSessionId: () => currentSession },
    ui: { notify: (message: string, type?: string) => { notifications.push({ message, type }); } },
  });
  return {
    root, project, piDir, handlers, sent, notifications, ctx,
    setSession(value: string) { currentSession = value; },
    setCwd(value: string) { currentCwd = value; },
    setTrusted(value: boolean) { trusted = value; },
    async close() { await rm(root, { recursive: true, force: true }); },
  };
}

async function withPiDir<T>(dir: string, run: () => Promise<T>): Promise<T> {
  const before = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try { return await run(); } finally {
    if (before === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = before;
  }
}

test("registers SessionStart and Stop on the actual Pi lifecycle boundaries", async () => {
  const f = await fixture({ hooks: {} });
  try {
    assert.ok(f.handlers.has("session_start"));
    assert.ok(f.handlers.has("agent_settled"));
    assert.equal(f.handlers.has("agent_end"), false);
    assert.equal(f.handlers.has("session_shutdown"), true);
  } finally { await f.close(); }
});

test("startup forwards validated SessionStart context and isolated marker/project environment", async () => {
  const f = await fixture({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: nodeCommand(
    "const fs=require('node:fs');let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{fs.writeFileSync(process.env.SIPOS_ESTADO_TARJETAS_FECHA, process.env.CLAUDE_PROJECT_DIR);console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:'daily context'}}))})",
  ) }] }] } });
  try {
    await withPiDir(f.piDir, async () => {
      await f.handlers.get("session_start")!({ reason: "startup" }, f.ctx());
      assert.deepEqual(f.sent, [{ message: { customType: "claude-session-start", content: "daily context", display: false }, options: { triggerTurn: false } }], JSON.stringify(f.notifications));
      assert.equal(await readFile(join(f.piDir, "sipos-estado-tarjetas.fecha"), "utf8"), f.project);
    });
  } finally { await f.close(); }
});

test("reload skips hooks and resume/new/fork pass sources without daily startup work", async () => {
  let seen = "";
  const f = await fixture((root: string) => {
    seen = join(root, "sources.txt");
    return { hooks: { SessionStart: [{ hooks: [{ type: "command", command: nodeCommand(
      `const fs=require('node:fs');let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{const x=JSON.parse(s);fs.appendFileSync(${JSON.stringify(seen)},String(x.source)+'\\n');if(x.source==='startup')fs.writeFileSync(process.env.SIPOS_ESTADO_TARJETAS_FECHA,'marker')})`,
    ) }] }] } };
  });
  try {
    await withPiDir(f.piDir, async () => {
      await f.handlers.get("session_start")!({ reason: "reload" }, f.ctx());
      await f.handlers.get("session_start")!({ reason: "unknown" }, f.ctx());
      await f.handlers.get("session_start")!({}, f.ctx());
      assert.equal(f.sent.length, 0);
      for (const reason of ["resume", "new", "fork"]) {
        f.setSession(`${reason}-session`);
        await f.handlers.get("session_start")!({ reason }, f.ctx());
        assert.equal(f.sent.length, 0);
      }
      assert.deepEqual((await readFile(seen, "utf8")).trim().split("\n"), ["resume", "clear", "fork"]);
      assert.equal(await readFile(join(f.piDir, "sipos-estado-tarjetas.fecha")).catch(() => ""), "");
    });
  } finally { await f.close(); }
});

test("Stop executes once after non-aborted settlement, reports output/errors, and stays nonblocking", async () => {
  let marker = "";
  const f = await fixture((root: string) => {
    marker = join(root, "stop.txt");
    return { hooks: { Stop: [{ hooks: [{ type: "command", async: true, command: nodeCommand(
      `require('node:fs').writeFileSync(${JSON.stringify(marker)},'finding');process.stdout.write('finding');process.stderr.write('detail')`
    ) }] }] } };
  });
  try {
    const start = Date.now();
    await f.handlers.get("agent_settled")!({ aborted: true }, f.ctx());
    await f.handlers.get("agent_end")?.({}, f.ctx());
    await f.handlers.get("agent_settled")!({ aborted: false }, f.ctx());
    assert.ok(Date.now() - start < 1_000);
    assert.equal(await waitForFile(marker), "finding");
    await waitForNotification(f.notifications, "finding");
    assert.deepEqual(f.notifications.at(-1), { message: "finding\ndetail", type: "info" });
    f.handlers.get("session_shutdown")!({}, f.ctx());
  } finally { await f.close(); }
});

for (const eventName of ["SessionStart", "Stop"] as const) {
  test(`${eventName} suppresses child failures after session, trust, or project identity changes`, async (t) => {
    for (const change of ["session", "trust", "root"] as const) {
      await t.test(change, async () => {
        let ready = "";
        let release = "";
        const f = await fixture((root: string) => {
          ready = join(root, "child-ready.json");
          release = join(root, "release-child");
          const command = nodeCommand(
            `const fs=require('node:fs'),p=require('node:path');let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const watch=fs.watch(${JSON.stringify(root)},()=>{if(fs.existsSync(${JSON.stringify(release)})){watch.close();process.exit(2)}});fs.writeFileSync(${JSON.stringify(ready)},JSON.stringify({input:process.env.TOOL_INPUT_FILE}))})`,
          );
          return { hooks: { [eventName]: [{ hooks: [{ type: "command", ...(eventName === "Stop" ? { async: true } : {}), command }] }] } };
        });
        try {
          const ctx = f.ctx();
          if (eventName === "SessionStart") {
            const handled = f.handlers.get("session_start")!({ reason: "startup" }, ctx);
            const { input } = JSON.parse(await waitForFile(ready)) as { input: string };
            if (change === "session") f.setSession("replacement-session");
            if (change === "trust") f.setTrusted(false);
            if (change === "root") {
              const alternative = join(f.root, "alternative-project");
              await mkdir(join(alternative, ".git"), { recursive: true });
              f.setCwd(alternative);
            }
            await writeFile(release, "exit");
            await handled;
            assert.equal(f.notifications.length, 0);
            assert.equal(await readFile(input).catch(() => ""), "");
          } else {
            f.handlers.get("agent_settled")!({ aborted: false }, ctx);
            const { input } = JSON.parse(await waitForFile(ready)) as { input: string };
            if (change === "session") f.setSession("replacement-session");
            if (change === "trust") f.setTrusted(false);
            if (change === "root") {
              const alternative = join(f.root, "alternative-project");
              await mkdir(join(alternative, ".git"), { recursive: true });
              f.setCwd(alternative);
            }
            await writeFile(release, "exit");
            await waitForMissingFile(input);
            assert.equal(f.notifications.length, 0);
          }
        } finally { await f.close(); }
      });
    }
  });
}

test("Stop timeout is bounded and reported without blocking settlement", async () => {
  const f = await fixture({ hooks: { Stop: [{ hooks: [{ type: "command", async: true, timeout: 0.2, command: nodeCommand("setTimeout(()=>process.stdout.write('late'),5000)") }] }] } });
  try {
    const start = Date.now();
    f.handlers.get("agent_settled")!({ aborted: false }, f.ctx());
    await waitForNotification(f.notifications, "timed out");
    assert.ok(Date.now() - start < 1_000);
    assert.match(f.notifications.at(-1)!.message, /timed out after 1s/);
  } finally { await f.close(); }
});

test("shutdown cancels Stop children and stale sessions cannot receive Stop output", async () => {
  const f = await fixture((root: string) => ({ hooks: { Stop: [{ hooks: [{ type: "command", async: true, command: nodeCommand(
    `const fs=require('node:fs'),p=require('node:path');let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{const id=JSON.parse(s).session_id;fs.writeFileSync(p.join(${JSON.stringify(root)},'started-'+id),'started');setTimeout(()=>{fs.writeFileSync(p.join(${JSON.stringify(root)},'completed-'+id),'done');process.stdout.write('late output')},150)})`
  ) }] }] } }));
  try {
    await f.handlers.get("agent_settled")!({ aborted: false }, f.ctx());
    await waitForFile(join(f.root, "started-session-id"));
    f.setSession("replacement-session");
    await waitForFile(join(f.root, "completed-session-id"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(f.notifications.length, 0);

    await f.handlers.get("agent_settled")!({ aborted: false }, f.ctx());
    await waitForFile(join(f.root, "started-replacement-session"));
    f.handlers.get("session_shutdown")!({}, f.ctx());
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(await readFile(join(f.root, "completed-replacement-session"), "utf8").catch(() => ""), "");
  } finally { await f.close(); }
});

test("PreToolUse passes successful commands and fails closed on command errors", async () => {
  const f = await fixture({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: nodeCommand(
    "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{if(JSON.parse(s).tool_input.command==='blocked'){process.stderr.write('denied');process.exit(2)}})"
  ) }] }] } });
  try {
    const hook = f.handlers.get("tool_call")!;
    assert.equal(await hook({ toolName: "bash", input: { command: "allowed" } }, f.ctx()), undefined);
    const blocked = await hook({ toolName: "bash", input: { command: "blocked" } }, f.ctx()) as { block?: boolean; reason?: string };
    assert.equal(blocked.block, true);
    assert.match(blocked.reason ?? "", /denied/);
  } finally { await f.close(); }
});

test("untrusted projects do not run lifecycle commands; Stop failures notify without escaping", async () => {
  let marker = "";
  const f = await fixture((root: string) => {
    marker = join(root, "untrusted.txt");
    return { hooks: { Stop: [{ hooks: [{ type: "command", command: nodeCommand(`require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran');process.stderr.write('bad');process.exit(2)`) }] }] } };
  });
  try {
    await f.handlers.get("agent_settled")!({ aborted: false }, f.ctx(f.project, false));
    assert.equal(await readFile(marker, "utf8").catch(() => ""), "");
    const errorContext = f.ctx();
    const notified = new Promise<void>((resolve) => {
      const original = errorContext.ui.notify;
      errorContext.ui.notify = (message: string, type?: string) => { original(message, type); resolve(); };
    });
    await f.handlers.get("agent_settled")!({ aborted: false }, errorContext);
    await notified;
    assert.match(f.notifications.at(-1)!.message, /bad/);
  } finally { await f.close(); }
});
