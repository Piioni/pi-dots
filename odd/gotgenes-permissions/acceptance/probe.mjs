import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createJiti } from '/home/piioni/.pi/agent/install/releases/1.4.0/node_modules/jiti/lib/jiti.mjs';

async function main() {
const root = path.resolve(`odd/gotgenes-permissions/acceptance/runtime-${process.pid}-${Date.now()}`);
assert.ok(root.startsWith(path.resolve('odd/gotgenes-permissions') + path.sep));
try {
const agentDir = path.join(root, 'agent');
const project = path.join(root, 'project');
await mkdir(path.join(agentDir, 'extensions/pi-permission-system'), { recursive: true });
await mkdir(path.join(project, '.pi/agent'), { recursive: true });
const candidateConfig = JSON.parse(await readFile('odd/gotgenes-permissions/candidate/config.json', 'utf8'));
if (process.env.PROBE_YOLO) candidateConfig.yoloMode = true;
await writeFile(path.join(agentDir, 'extensions/pi-permission-system/config.json'), JSON.stringify(candidateConfig, null, 2));
await mkdir(path.join(project, 'fixtures/secrets'), { recursive: true });
await mkdir(path.join(project, 'fixtures/dotenv'), { recursive: true });
await writeFile(path.join(project, 'fixtures/secrets/private.txt'), 'synthetic only\n');
await writeFile(path.join(project, 'fixtures/dotenv/.env'), 'synthetic only\n');
await writeFile(path.join(project, 'fixtures/plain.txt'), 'synthetic only\n');
const alias = path.join(project, 'fixtures/secret-alias');
await symlink(path.join(project, 'fixtures/dotenv/.env'), alias);
assert.equal(await realpath(alias), await realpath(path.join(project, 'fixtures/dotenv/.env')));

process.env.PI_CODING_AGENT_DIR = agentDir;
const extPath = path.resolve('odd/gotgenes-permissions/sandbox/package/src/index.ts');
const extension = await createJiti(import.meta.url).import(extPath);
const handlers = new Map();
const eventHandlers = new Map();
const eventBus = {
  on(name, fn) { const list = eventHandlers.get(name) ?? []; list.push(fn); eventHandlers.set(name, list); return () => {}; },
  emit(name, payload) { for (const fn of eventHandlers.get(name) ?? []) fn(payload); },
};
const tools = ['bash', 'read', 'grep', 'mcp__linear__get_issue', 'mcp__linear__create_issue', 'mcp__linear__list_issue_labels', 'mcp__linear__get_issue_label', 'mcp__engram__mem_search', 'custom:reader'].map(name => ({ name, exposure: 'direct' }));
const pi = {
  events: eventBus,
  on(name, fn) { handlers.set(name, fn); return () => {}; },
  registerCommand() {},
  getAllTools() { return tools; },
  getActiveTools() { return tools.map(t => t.name); },
  setActiveTools() {},
};
extension.default(pi);
const notices = [];
const ctx = {
  cwd: project,
  mode: 'rpc',
  hasUI: false,
  isProjectTrusted: () => true,
  sessionManager: { getSessionId: () => 'synthetic-session', getSessionDir: () => path.join(root, 'sessions'), getEntries: () => [], getBranch: () => [] },
  ui: { notify: (...args) => notices.push(args), setStatus() {}, confirm: async () => false, custom: async () => undefined },
};
await handlers.get('session_start')({ reason: 'new' }, ctx);
const { getPermissionsService } = await createJiti(import.meta.url).import(path.resolve('odd/gotgenes-permissions/sandbox/package/src/service.ts'));
const service = getPermissionsService('synthetic-session');
assert.ok(service, 'extension publishes its service at session_start');
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
  const result = service.checkPermission(surface, value);
  const got = result.state;
  outcomes.push(`${surface} ${value} => ${got}`);
  if (got !== expected) outcomes[outcomes.length - 1] += ` (expected ${expected}, actual ${got})`;
}

const bareResults = bareCommands.map(command => {
  const got = service.checkPermission('bash', command).state;
  if (got !== 'ask') outcomes.push(`bash ${command} => ${got} (expected ask)`);
  return `${command} => ${got}`;
});
// A no-UI tool_call block is an ask rejected for unavailable approval, not a policy deny.
const hook = handlers.get('tool_call');
assert.ok(hook, 'extension registers Pi tool_call handler');
let callbackCount = 0;
const syntheticCallback = () => { callbackCount++; };
async function intercepted(toolName, input, parentToolCallId) {
  const result = await hook({ toolName, input, toolCallId: `synthetic-${callbackCount}`, ...(parentToolCallId ? { parentToolCallId } : {}) }, ctx);
  if (!result?.block) syntheticCallback();
  return result;
}
for (const [toolName, input, shouldBlock] of [
  ['read', { path: path.join(project, 'fixtures/dotenv/.env') }, true],
  ['grep', { path: path.join(project, 'fixtures/dotenv/.env'), pattern: 'synthetic' }, true],
  ['read', { path: alias }, true],
  ['custom:reader', { path: path.join(project, 'fixtures/secrets/.env') }, true],
  ['write', { path: '/etc/synthetic-config', content: 'synthetic' }, true],
  ['edit', { path: '/etc/synthetic-config', oldText: 'x', newText: 'y' }, true],
  ['bash', { command: `cat ${path.join(project, 'fixtures/dotenv/.env')}` }, true],
  ['bash', { command: `cat ${alias}` }, true],
  ['bash', { command: 'sudo -n true' }, true],
  ['bash', { command: 'git status' }, false],
  ['read', { path: path.join(root, 'outside.txt') }, false],
  ['mcp__linear__get_issue', { id: 'synthetic-id' }, false],
  ['mcp__linear__list_issue_labels', {}, false],
  ['mcp__linear__get_issue_label', { id: 'synthetic-id' }, false],
  ['mcp__engram__mem_search', { query: 'synthetic' }, false],
  ['mcp__linear__create_issue', { title: 'synthetic' }, true],
]) {
  const result = await intercepted(toolName, input);
  const actualBlock = Boolean(result?.block);
  if (actualBlock !== shouldBlock) outcomes.push(`tool_call ${toolName}: expected ${shouldBlock ? 'block' : 'allow'}, actual ${actualBlock ? 'block' : 'allow'}`);
}
for (const command of bareCommands) {
  const result = await intercepted('bash', { command });
  if (!result?.block) outcomes.push(`tool_call bash ${command}: expected no-UI ask rejection, actual continued`);
}
const failures = outcomes.filter(line => line.includes('(expected '));
assert.deepEqual(failures, [], `boundary mismatches:\n${failures.join('\\n')}`);
const beforeRejected = callbackCount;
const codemodeRejected = await intercepted('mcp__linear__create_issue', { title: 'synthetic' }, 'synthetic-codemode-parent');
assert.equal(Boolean(codemodeRejected?.block), true, 'nested/codemode MCP mutation remains gated');
const rejected = await intercepted('bash', { command: 'git push origin branch' });
assert.equal(Boolean(rejected?.block), true, 'ask without UI is rejected');
assert.equal(callbackCount, beforeRejected, 'rejected ask never invokes callback');
assert.equal(callbackCount, 6, 'only allowed status/external/MCP reads reached callback');
const skillInput = await handlers.get('input')({ text: '/skill:synthetic-skill' }, ctx);
assert.equal(skillInput?.action, 'continue', 'allowed skill input remains available');
assert.equal(notices.some(args => /invalid|error/i.test(String(args[0]))), false, 'no configuration validation errors');
const configPath = path.join(agentDir, 'extensions/pi-permission-system/config.json');
const activeConfig = JSON.parse(await readFile(configPath, 'utf8'));
assert.equal(activeConfig.forwardingTimeoutMs, 30000);
assert.equal(activeConfig.permissionReviewLog, true);
const reviewPath = path.join(agentDir, 'extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl');
const review = await readFile(reviewPath, 'utf8');
assert.match(review, /permission_request\.blocked/);
console.log(outcomes.join('\n'));
console.log(`argument-free Bash: ${bareResults.join('; ')}`);
console.log(`tool_call interception: callbackCount=${callbackCount}; ask rejected without callback`);
console.log(`review log observed at ${reviewPath}; forwardingTimeoutMs=${activeConfig.forwardingTimeoutMs}`);
const yolo = spawnSync(process.execPath, [new URL(import.meta.url).pathname], { encoding: 'utf8', env: { ...process.env, PROBE_YOLO: '1' } });
assert.equal(yolo.status, 0, `YOLO subprocess failed: ${yolo.stderr}`);
process.stdout.write(yolo.stdout);
} finally {
  await rm(root, { recursive: true, force: true });
}
}
main().catch(error => { console.error(error); process.exitCode = 1; });
