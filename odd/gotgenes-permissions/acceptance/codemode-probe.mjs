import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(`odd/gotgenes-permissions/acceptance/codemode-${process.pid}-${Date.now()}`);
assert.ok(root.startsWith(path.resolve('odd/gotgenes-permissions') + path.sep));
try {
  const agentDir = path.join(root, 'agent');
  const cwd = path.join(root, 'project');
  await mkdir(path.join(agentDir, 'extensions/pi-permission-system'), { recursive: true });
  await mkdir(cwd, { recursive: true });
  await writeFile(path.join(agentDir, 'extensions/pi-permission-system/config.json'), await readFile('odd/gotgenes-permissions/candidate/config.json'));
  const packageRoot = process.env.GOTGENES_PACKAGE_ROOT ?? path.resolve('odd/gotgenes-permissions/sandbox/package');
  await writeFile(path.join(agentDir, 'settings.json'), JSON.stringify({ extensions: ['-builtin:mcp'], defaultTools: ['+codemode'], packages: [{ source: packageRoot }] }, null, 2));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const pi = await import('/home/piioni/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/index.js');
  const { Type } = await import('/home/piioni/.pi/agent/install/releases/1.4.0/node_modules/typebox/build/index.mjs');
  let callbackCount = 0;
  const cwdSettings = pi.SettingsManager.create(cwd, agentDir);
  const loader = new pi.DefaultResourceLoader({
    cwd, agentDir, settingsManager: cwdSettings, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [
      pi.createCodemodeExtension({ mode: 'on' }),
      api => api.registerTool({
        name: 'mcp__linear__create_issue', label: 'Synthetic Linear create', description: 'Synthetic tool; no remote endpoint.',
        parameters: Type.Object({ title: Type.String() }), exposure: 'codemode',
        execute: async () => { callbackCount++; return { content: [{ type: 'text', text: 'synthetic callback ran' }], details: undefined }; },
      }),
    ],
  });
  await loader.reload();
  assert.equal(loader.getExtensions().errors.length, 0);
  const { session } = await pi.createAgentSession({ cwd, agentDir, settingsManager: cwdSettings, resourceLoader: loader, sessionManager: pi.SessionManager.inMemory(cwd), tools: ['codemode'] });
  try {
    await session.bindExtensions({});
    const tool = session.extensionRunner.getToolDefinition('codemode');
    assert.ok(tool, 'host codemode tool loaded');
    const context = session.extensionRunner.createToolContext('codemode-probe', undefined);
    const result = await tool.execute('codemode-probe', { code: "await tools.mcp__linear__create_issue({title:'synthetic'}); return 'completed'" }, undefined, () => {}, context);
    assert.equal(callbackCount, 0, 'permission-denied nested MCP callback never ran');
    assert.match(result.content.map(c => c.text ?? '').join(''), /Script failed|Script error|not approved|not permitted/i);
    console.log(`host codemode nested MCP: callbackCount=${callbackCount}; blocked=${/Script failed|not approved|not permitted/i.test(result.content.map(c => c.text ?? '').join(''))}`);
  } finally {
    session.dispose();
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
