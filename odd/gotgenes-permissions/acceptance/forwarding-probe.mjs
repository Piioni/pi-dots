import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(`odd/gotgenes-permissions/acceptance/forwarding-${process.pid}-${Date.now()}`);
assert.ok(root.startsWith(path.resolve('odd/gotgenes-permissions') + path.sep));
try {
  const agentDir = path.join(root, 'agent');
  const cwd = path.join(root, 'project');
  await mkdir(path.join(agentDir, 'extensions/pi-permission-system'), { recursive: true });
  await mkdir(cwd, { recursive: true });
  const config = JSON.parse(await readFile('odd/gotgenes-permissions/candidate/config.json', 'utf8'));
  config.forwardingTimeoutMs = 300;
  await writeFile(path.join(agentDir, 'extensions/pi-permission-system/config.json'), JSON.stringify(config, null, 2));
  const packageRoot = process.env.GOTGENES_PACKAGE_ROOT ?? path.resolve('odd/gotgenes-permissions/sandbox/package');
  await writeFile(path.join(agentDir, 'settings.json'), JSON.stringify({ extensions: ['-builtin:mcp'], packages: [{ source: packageRoot }] }, null, 2));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const pi = await import('/home/piioni/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/index.js');
  const makeSession = async ({ ui, observe } = {}) => {
    const settingsManager = pi.SettingsManager.create(cwd, agentDir);
    const resourceLoader = new pi.DefaultResourceLoader({
      cwd, agentDir, settingsManager, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      ...(observe ? { extensionFactories: [observe] } : {}),
    });
    await resourceLoader.reload();
    assert.equal(resourceLoader.getExtensions().errors.length, 0);
    const { session } = await pi.createAgentSession({ cwd, agentDir, settingsManager, resourceLoader, sessionManager: pi.SessionManager.inMemory(cwd), tools: ['bash'] });
    await session.bindExtensions(ui ? { mode: 'rpc', uiContext: ui } : {});
    return session;
  };
  const disposeSession = async (session) => {
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    session.dispose();
  };
  const parent = await makeSession();
  const child = await makeSession();
  try {
    const parentId = parent.sessionManager.getSessionId();
    const previous = process.env.PI_SUBAGENT_PARENT_SESSION;
    process.env.PI_SUBAGENT_PARENT_SESSION = parentId;
    const started = Date.now();
    let callbackCount = 0;
    const result = await child.extensionRunner.emitToolCall({ toolName: 'bash', input: { command: 'git push origin synthetic-branch' }, toolCallId: 'forward-timeout' });
    if (!result?.block) callbackCount++;
    const elapsed = Date.now() - started;
    if (previous === undefined) delete process.env.PI_SUBAGENT_PARENT_SESSION;
    else process.env.PI_SUBAGENT_PARENT_SESSION = previous;
    assert.equal(Boolean(result?.block), true, 'unanswered forwarded ask is blocked');
    assert.equal(callbackCount, 0, 'timed-out forwarded ask never executes callback');
    assert.ok(elapsed >= 200 && elapsed < 5000, `expected bounded 300ms timeout, observed ${elapsed}ms`);
    const logs = path.join(agentDir, 'extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl');
    const log = await readFile(logs, 'utf8');
    assert.match(log, /forwarded_permission\.response_timed_out/);
    assert.equal(config.forwardingTimeoutMs, 300);
    const deployed = JSON.parse(await readFile('odd/gotgenes-permissions/candidate/config.json', 'utf8'));
    assert.equal(deployed.forwardingTimeoutMs, 30000);
    console.log(`public ExtensionRunner.emitToolCall: blocked=${Boolean(result?.block)}; callbackCount=${callbackCount}; elapsedMs=${elapsed}; forwardingTimeoutMs=${config.forwardingTimeoutMs}`);
    console.log('review event=forwarded_permission.response_timed_out; deployable forwardingTimeoutMs=30000; no model/MCP calls');
  } finally {
    await disposeSession(child);
    await disposeSession(parent);
  }

  for (const [choice, expectedBlocked, label] of [
    ['Yes', false, 'approved'],
    ['No', true, 'denied'],
    [undefined, true, 'cancelled'],
  ]) {
    const promptEvents = [];
    const decisionEvents = [];
    const ui = {
      select: async () => choice,
      input: async () => undefined,
      notify() {},
      setStatus() {},
    };
    const approvalParent = await makeSession({ ui, observe: (api) => {
      api.events.on('permissions:ui_prompt', event => promptEvents.push(event));
      api.events.on('permissions:decision', event => decisionEvents.push(event));
    } });
    const approvalChild = await makeSession();
    const previous = process.env.PI_SUBAGENT_PARENT_SESSION;
    try {
      process.env.PI_SUBAGENT_PARENT_SESSION = approvalParent.sessionManager.getSessionId();
      let callbackCount = 0;
      const forwarded = await approvalChild.extensionRunner.emitToolCall({
        toolName: 'bash', input: { command: `git push origin synthetic-${label}` }, toolCallId: `forward-${label}`,
      });
      if (!forwarded?.block) callbackCount++;
      assert.equal(Boolean(forwarded?.block), expectedBlocked, `${label} forwarded result`);
      assert.equal(callbackCount, expectedBlocked ? 0 : 1, `${label} callback count`);
      assert.equal(promptEvents.length, 1, `${label} reaches the real parent UI prompt`);
      assert.equal(promptEvents[0].forwarding.requesterSessionId, approvalChild.sessionManager.getSessionId());
      assert.equal(decisionEvents.length, 1, `${label} produces terminal public decision event`);
      assert.equal(decisionEvents[0].result, expectedBlocked ? 'deny' : 'allow');
      assert.equal(decisionEvents[0].resolution, choice === 'Yes' ? 'user_approved' : 'user_denied');
      console.log(`public forwarding ${label}: prompt=1; decision=${decisionEvents[0].resolution}; blocked=${Boolean(forwarded?.block)}; callbackCount=${callbackCount}`);
    } finally {
      if (previous === undefined) delete process.env.PI_SUBAGENT_PARENT_SESSION;
      else process.env.PI_SUBAGENT_PARENT_SESSION = previous;
      await disposeSession(approvalChild);
      await disposeSession(approvalParent);
    }
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
