import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createJiti } from '/home/piioni/.pi/agent/install/releases/1.4.0/node_modules/jiti/lib/jiti.mjs';

async function main() {
  const root = path.resolve(`odd/gotgenes-permissions/acceptance/runtime-${process.pid}-${Date.now()}`);
  assert.ok(root.startsWith(path.resolve('odd/gotgenes-permissions') + path.sep));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  let session;
  try {
    const agentDir = path.join(root, 'agent');
    const project = path.join(root, 'project');
    const globalExtension = path.join(agentDir, 'extensions/pi-permission-system');
    const packageRoot = process.env.GOTGENES_PACKAGE_ROOT ?? path.resolve('odd/gotgenes-permissions/sandbox/package');
    await mkdir(globalExtension, { recursive: true });
    await mkdir(path.join(project, '.pi/extensions/pi-permission-system'), { recursive: true });
    await mkdir(path.join(project, '.pi/agents'), { recursive: true });
    await mkdir(path.join(agentDir, 'agents'), { recursive: true });
    await writeFile(path.join(project, '.pi/extensions/pi-permission-system/config.json'), JSON.stringify({ permission: { bash: { 'git synthetic-scope': 'ask' } } }));
    await writeFile(path.join(agentDir, 'agents/global-agent.md'), '---\nname: global-agent\npermission:\n  bash:\n    git synthetic-scope: deny\n---\n');
    await writeFile(path.join(project, '.pi/agents/project-agent.md'), '---\nname: project-agent\npermission:\n  bash:\n    git synthetic-scope: allow\n---\n');
    const candidateConfig = JSON.parse(await readFile('odd/gotgenes-permissions/candidate/config.json', 'utf8'));
    if (process.env.PROBE_YOLO) candidateConfig.yoloMode = true;
    await writeFile(path.join(globalExtension, 'config.json'), JSON.stringify(candidateConfig, null, 2));
    await mkdir(path.join(project, 'fixtures/secrets'), { recursive: true });
    await mkdir(path.join(project, 'fixtures/dotenv'), { recursive: true });
    await writeFile(path.join(project, 'fixtures/secrets/private.txt'), 'synthetic only\n');
    await writeFile(path.join(project, 'fixtures/dotenv/.env'), 'synthetic only\n');
    const alias = path.join(project, 'fixtures/secret-alias');
    await symlink(path.join(project, 'fixtures/dotenv/.env'), alias);
    assert.equal(await realpath(alias), await realpath(path.join(project, 'fixtures/dotenv/.env')));

    process.env.PI_CODING_AGENT_DIR = agentDir;
    const pi = await import('/home/piioni/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/index.js');
    const { Type } = await import('/home/piioni/.pi/agent/install/releases/1.4.0/node_modules/typebox/build/index.mjs');
    await writeFile(path.join(agentDir, 'settings.json'), JSON.stringify({
      defaultProjectTrust: 'always',
      extensions: ['-builtin:mcp'],
      packages: [{ source: packageRoot }],
    }, null, 2));
    const settingsManager = pi.SettingsManager.create(project, agentDir);
    const fakeTools = [
      ['custom_reader', { path: Type.String() }],
      ['mcp__linear__get_issue', { id: Type.String() }],
      ['mcp__linear__list_issue_labels', {}],
      ['mcp__linear__get_issue_label', { id: Type.String() }],
      ['mcp__engram__mem_search', { query: Type.String() }],
      ['mcp__linear__create_issue', { title: Type.String() }],
    ];
    const toolFactories = fakeTools.map(([name, properties]) => (api) => api.registerTool({
      name, label: `Synthetic ${name}`, description: 'Synthetic fixture; no remote endpoint.',
      parameters: Type.Object(properties), execute: async () => ({ content: [{ type: 'text', text: 'synthetic only' }], details: undefined }),
    }));
    const loader = new pi.DefaultResourceLoader({
      cwd: project, agentDir, settingsManager, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: toolFactories,
    });
    await loader.reload();
    assert.equal(loader.getExtensions().errors.length, 0, JSON.stringify(loader.getExtensions().errors));
    const created = await pi.createAgentSession({
      cwd: project, agentDir, settingsManager, resourceLoader: loader,
      sessionManager: pi.SessionManager.inMemory(project), tools: ['bash', 'read', 'grep', 'write', 'edit'],
    });
    session = created.session;
    await session.bindExtensions({ mode: 'print' });
    const sessionId = session.sessionManager.getSessionId();
    const { getPermissionsService } = await createJiti(import.meta.url).import(path.join(packageRoot, 'src/service.ts'));
    const service = getPermissionsService(sessionId);
    assert.ok(service, 'installed extension publishes its public service at session_start');
    assert.equal(service.checkPermission('bash', 'git synthetic-scope').state, process.env.PROBE_YOLO ? 'allow' : 'ask', 'trusted project config overrides global allow (or YOLO rewrites ask)');
    assert.equal(service.checkPermission('bash', 'git synthetic-scope', 'global-agent').state, 'deny', 'global agent overrides project policy');
    assert.equal(service.checkPermission('bash', 'git synthetic-scope', 'project-agent').state, 'allow', 'trusted project agent overrides global agent');
    console.log('trusted synthetic scope composition: project ask > global allow; global-agent deny; project-agent allow');

    const bareCommands = ['git push', 'git reset --hard', 'git clean', 'git worktree remove', 'rm', 'kill', 'pkill', 'gh pr create', 'gh pr merge', 'gh release'];
    if (process.env.PROBE_YOLO) {
      assert.equal(service.checkPermission('bash', 'git push origin branch').state, 'allow');
      for (const command of bareCommands) assert.equal(service.checkPermission('bash', command).state, 'allow', `YOLO ${command}`);
      assert.equal(service.checkPermission('bash', 'sudo -n true').state, 'deny');
      assert.equal(service.checkPermission('path', path.join(project, 'fixtures/dotenv/.env')).state, 'deny');
      console.log('YOLO startup: ask=>allow; sudo/path deny remain deny');
      return;
    }

    const outcomes = [];
    for (const [surface, value, expected] of [
      ['read', undefined, 'allow'],
      ['path', path.join(project, 'fixtures/dotenv/.env'), 'deny'],
      ['path', path.join(project, 'fixtures/secrets/private.txt'), 'deny'],
      ['path', alias, 'deny'],
      ['path_read', '/etc/synthetic-config', 'allow'],
      ['path_write', '/etc/synthetic-config', 'deny'],
      ['path', '/home/piioni/.ssh/synthetic-key', 'deny'],
      ['external_directory', '/home/piioni/.ssh/synthetic-key', 'deny'],
      ['bash', 'git status', 'allow'],
      ['bash', 'git push origin branch', 'ask'],
      ['bash', 'git reset --hard synthetic', 'ask'],
      ['bash', 'git clean -fd synthetic', 'ask'],
      ['bash', 'git worktree remove synthetic', 'ask'],
      ['bash', 'rm -f synthetic', 'ask'],
      ['bash', 'kill 12345', 'ask'],
      ['bash', 'pkill synthetic', 'ask'],
      ['bash', 'gh pr create --title synthetic', 'ask'],
      ['bash', 'gh pr merge 12345', 'ask'],
      ['bash', 'gh release create synthetic', 'ask'],
      ['bash', 'sudo -n true', 'deny'],
      ['mcp', 'linear:get_issue', 'allow'],
      ['mcp', 'linear:list_issues', 'allow'],
      ['mcp', 'linear:list_issue_labels', 'allow'],
      ['mcp', 'linear:get_issue_label', 'allow'],
      ['mcp', 'engram:mem_search', 'allow'],
      ['mcp', 'linear:search_documentation', 'allow'],
      ['mcp', 'linear:extract_images', 'allow'],
      ['mcp', 'linear:save_comment', 'ask'],
      ['mcp', 'linear:create_issue', 'ask'],
      ['mcp', 'linear:delete_issue', 'ask'],
      ['mcp', 'linear:prepare_attachment_upload', 'ask'],
      ['mcp', 'linear:update_diff', 'ask'],
      ['mcp', 'linear:resolve_diff_thread', 'ask'],
      ['mcp', 'linear:submit_diff_review', 'ask'],
      ['mcp', 'linear:merge_diff', 'ask'],
      ['mcp', 'linear:share_issue', 'ask'],
      ['mcp', 'linear:unshare_issue', 'ask'],
      ['mcp', 'linear:mark_notification', 'ask'],
      ['mcp', 'linear:remove_label', 'ask'],
      ['mcp', 'linear:restore_label', 'ask'],
      ['skill', 'synthetic-skill', 'allow'],
      ['external_directory', path.join(root, 'outside.txt'), 'allow'],
    ]) {
      const got = service.checkPermission(surface, value).state;
      outcomes.push(`${surface} ${value} => ${got}`);
      if (got !== expected) outcomes[outcomes.length - 1] += ` (expected ${expected}, actual ${got})`;
    }
    const bareResults = bareCommands.map((command) => {
      const got = service.checkPermission('bash', command).state;
      if (got !== 'ask') outcomes.push(`bash ${command} => ${got} (expected ask)`);
      return `${command} => ${got}`;
    });

    let callbackCount = 0;
    async function intercept(toolName, input, parentToolCallId) {
      const result = await session.extensionRunner.emitToolCall({
        toolName, input, toolCallId: `synthetic-${callbackCount}`,
        ...(parentToolCallId ? { parentToolCallId } : {}),
      });
      if (!result?.block) callbackCount++;
      return result;
    }
    for (const [toolName, input, shouldBlock] of [
      ['read', { path: path.join(project, 'fixtures/dotenv/.env') }, true],
      ['grep', { path: path.join(project, 'fixtures/dotenv/.env'), pattern: 'synthetic' }, true],
      ['read', { path: alias }, true],
      ['custom_reader', { path: path.join(project, 'fixtures/secrets/.env') }, true],
      ['write', { path: '/etc/synthetic-config', content: 'synthetic' }, true],
      ['edit', { path: '/etc/synthetic-config', oldText: 'x', newText: 'y' }, true],
      ['bash', { command: `cat ${path.join(project, 'fixtures/dotenv/.env')}` }, true],
      ['bash', { command: `cat ${alias}` }, true],
      ['bash', { command: 'sudo -n true' }, true],
      ['bash', { command: 'git status' }, false],
      ['read', { path: path.join(root, 'outside.txt') }, false],
      ['mcp__linear__get_issue', { id: 'synthetic-id' }, false],
      ['mcp__linear__list_issue_labels', {} , false],
      ['mcp__linear__get_issue_label', { id: 'synthetic-id' }, false],
      ['mcp__engram__mem_search', { query: 'synthetic' }, false],
      ['mcp__linear__create_issue', { title: 'synthetic' }, true],
    ]) {
      const result = await intercept(toolName, input);
      const actualBlock = Boolean(result?.block);
      if (actualBlock !== shouldBlock) outcomes.push(`tool_call ${toolName}: expected ${shouldBlock ? 'block' : 'allow'}, actual ${actualBlock ? 'block' : 'allow'}`);
    }
    for (const command of bareCommands) {
      const result = await intercept('bash', { command });
      if (!result?.block) outcomes.push(`tool_call bash ${command}: expected no-UI ask rejection, actual continued`);
    }
    assert.deepEqual(outcomes.filter(line => line.includes('(expected ')), [], `boundary mismatches:\n${outcomes.join('\n')}`);
    const beforeRejected = callbackCount;
    assert.equal(Boolean((await intercept('mcp__linear__create_issue', { title: 'synthetic' }, 'synthetic-codemode-parent'))?.block), true);
    assert.equal(Boolean((await intercept('bash', { command: 'git push origin branch' }))?.block), true);
    assert.equal(callbackCount, beforeRejected, 'rejected asks never dispatch the synthetic callback');
    assert.equal(callbackCount, 6, 'only allowed status/external/MCP reads reached synthetic dispatch');
    const inputResult = await session.extensionRunner.emitInput('/skill:synthetic-skill', undefined, 'interactive');
    assert.equal(inputResult.action, 'continue', 'allowed skill input remains available');

    const config = JSON.parse(await readFile(path.join(globalExtension, 'config.json'), 'utf8'));
    assert.equal(config.forwardingTimeoutMs, 30000);
    assert.equal(config.permissionReviewLog, true);
    const logs = path.join(globalExtension, 'logs/pi-permission-system-permission-review.jsonl');
    assert.match(await readFile(logs, 'utf8'), /permission_request\.blocked/);
    console.log(outcomes.join('\n'));
    console.log(`argument-free Bash: ${bareResults.join('; ')}`);
    console.log(`actual Pi ExtensionRunner interception: syntheticDispatchCount=${callbackCount}; rejected asks dispatch zero callbacks`);
    console.log(`review log observed in isolated agent dir; forwardingTimeoutMs=${config.forwardingTimeoutMs}`);
    const yolo = spawnSync(process.execPath, [new URL(import.meta.url).pathname], { encoding: 'utf8', env: { ...process.env, PROBE_YOLO: '1' } });
    assert.equal(yolo.status, 0, `YOLO subprocess failed: ${yolo.stderr}`);
    process.stdout.write(yolo.stdout);
  } finally {
    if (session) {
      await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
      session.dispose();
    }
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
