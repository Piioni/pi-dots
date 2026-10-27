import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createJiti } from '/home/piioni/.pi/agent/install/releases/1.4.0/node_modules/jiti/lib/jiti.mjs';

async function main() {
const root = path.resolve(`odd/gotgenes-permissions/acceptance/legacy-${process.pid}-${Date.now()}`);
assert.ok(root.startsWith(path.resolve('odd/gotgenes-permissions') + path.sep));
try {
const agent = path.join(root, 'agent');
const cwd = path.join(root, 'project');
await mkdir(path.join(agent, 'extensions/pi-permission-system'), { recursive: true });
await mkdir(cwd, { recursive: true });
await writeFile(path.join(cwd, '.env'), 'synthetic only\\n');
await writeFile(path.join(agent, 'pi-permissions.jsonc'), await readFile('odd/gotgenes-permissions/backups/pi-permissions.jsonc'));
await writeFile(path.join(agent, 'extensions/pi-permission-system/config.json'), await readFile('odd/gotgenes-permissions/backups/config.json'));
process.env.PI_CODING_AGENT_DIR = agent;
const jiti = createJiti(import.meta.url);
const legacyRoot = await import('node:fs/promises').then(({ access }) => access('extensions/pi-permission-system/src/index.ts').then(() => path.resolve('extensions/pi-permission-system')).catch(() => path.resolve('disabled-extensions/pi-permission-system')));
const extension = await jiti.import(path.join(legacyRoot, 'src/index.ts'));
const { PermissionManager } = await jiti.import(path.join(legacyRoot, 'src/permission-manager.ts'));
const legacyManager = new PermissionManager({
  globalConfigPath: path.join(agent, 'pi-permissions.jsonc'),
  agentsDir: path.join(agent, 'agents'),
  legacyGlobalSettingsPath: path.join(agent, 'settings.json'),
  globalMcpConfigPath: path.join(agent, 'mcp.json'),
});
const handlers = new Map();
const events = { on() { return () => {}; }, emit() {} };
const tools = ['read', 'bash', 'mcp__linear__get_issue', 'mcp__linear__create_issue'].map(name => ({ name, description: 'synthetic fixture' }));
const pi = { events, on: (n, f) => handlers.set(n, f), registerCommand() {}, getAllTools: () => tools, getActiveTools: () => tools.map(t => t.name), setActiveTools() {} };
extension.default(pi);
const ctx = {
  cwd, mode: 'rpc', hasUI: false, isProjectTrusted: () => true,
  sessionManager: { getSessionId: () => 'legacy-session', getSessionDir: () => path.join(root, 'sessions'), getEntries: () => [], getBranch: () => [] },
  ui: { notify() {}, setStatus() {}, confirm: async () => false, custom: async () => undefined },
};
await handlers.get('session_start')({ reason: 'new' }, ctx);
const hook = handlers.get('tool_call');
assert.ok(hook, 'legacy extension registers Pi tool_call handler');
const noUiOutcomes = {};
for (const [key, name, input] of [
  ['read ordinary', 'read', { path: path.join(cwd, 'ordinary.txt') }],
  ['read secret', 'read', { path: path.join(cwd, '.env') }],
  ['bash status', 'bash', { command: 'git status' }],
  ['bash push', 'bash', { command: 'git push origin synthetic' }],
  ['bash cat secret', 'bash', { command: `cat ${path.join(cwd, '.env')}` }],
  ['Linear read', 'mcp__linear__get_issue', { id: 'synthetic' }],
  ['Linear write', 'mcp__linear__create_issue', { title: 'synthetic' }],
]) {
  const result = await hook({ toolName: name, input, toolCallId: `legacy-${key}` }, ctx);
  noUiOutcomes[key] = result?.block ? 'rejected' : 'continued';
}
assert.deepEqual(noUiOutcomes, {
  'read ordinary': 'continued', 'read secret': 'rejected', 'bash status': 'continued',
  'bash push': 'rejected', 'bash cat secret': 'continued', 'Linear read': 'continued', 'Linear write': 'continued',
});
const bareCommands = ['git push', 'git reset --hard', 'git clean', 'git worktree remove', 'rm', 'kill', 'pkill', 'gh pr create', 'gh pr merge', 'gh release'];
const bareDecisions = {};
const bareNoUiOutcomes = {};
for (const command of bareCommands) {
  bareDecisions[command] = legacyManager.checkPermission('bash', { command }).state;
  const result = await hook({ toolName: 'bash', input: { command }, toolCallId: `legacy-bare-${command}` }, ctx);
  bareNoUiOutcomes[command] = result?.block ? 'rejected' : 'continued';
}
assert.ok(Object.values(bareDecisions).every(result => result === 'ask'), JSON.stringify(bareDecisions));
assert.ok(Object.values(bareNoUiOutcomes).every(result => result === 'rejected'), JSON.stringify(bareNoUiOutcomes));
console.log(JSON.stringify({ noUiOutcomes, legacyBareDecisions: bareDecisions, bareNoUiOutcomes }));
await handlers.get('session_shutdown')?.();
} finally {
  await rm(root, { recursive: true, force: true });
}
}
main().catch(error => { console.error(error); process.exitCode = 1; });
