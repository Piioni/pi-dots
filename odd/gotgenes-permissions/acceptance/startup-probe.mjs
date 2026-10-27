import assert from 'node:assert/strict';
import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(`odd/gotgenes-permissions/acceptance/loader-${process.pid}-${Date.now()}`);
assert.ok(root.startsWith(path.resolve('odd/gotgenes-permissions') + path.sep));
async function isClone(root) {
  try {
    await Promise.all([access(path.join(root, 'index.ts')), access(path.join(root, 'src/index.ts'))]);
    return true;
  } catch {
    return false;
  }
}
async function selectClone(agentDir) {
  for (const candidate of ['extensions/pi-permission-system', 'disabled-extensions/pi-permission-system']) {
    const root = path.join(agentDir, candidate);
    if (await isClone(root)) return root;
  }
  throw new Error(`No complete permission clone found under ${agentDir}`);
}
try {
  const agentDir = path.join(root, 'agent');
  const cwd = path.join(root, 'project');
  const configOnlyExtension = path.join(agentDir, 'extensions/pi-permission-system');
  const archivedClone = path.join(agentDir, 'disabled-extensions/pi-permission-system');
  const selectedSource = await selectClone(process.cwd());
  const activeFixture = path.join(root, 'source-active');
  const archiveFixture = path.join(root, 'source-archive');
  for (const fixtureRoot of [activeFixture, archiveFixture]) {
    await mkdir(path.join(fixtureRoot, 'extensions/pi-permission-system/src'), { recursive: true });
    await writeFile(path.join(fixtureRoot, 'extensions/pi-permission-system/index.ts'), '// synthetic source marker');
    await writeFile(path.join(fixtureRoot, 'extensions/pi-permission-system/src/index.ts'), '// synthetic source marker');
  }
  await mkdir(path.join(archiveFixture, 'disabled-extensions/pi-permission-system/src'), { recursive: true });
  await writeFile(path.join(archiveFixture, 'disabled-extensions/pi-permission-system/index.ts'), '// synthetic source marker');
  await writeFile(path.join(archiveFixture, 'disabled-extensions/pi-permission-system/src/index.ts'), '// synthetic source marker');
  assert.equal(await selectClone(activeFixture), path.join(activeFixture, 'extensions/pi-permission-system'));
  await rm(path.join(archiveFixture, 'extensions/pi-permission-system'), { recursive: true });
  assert.equal(await selectClone(archiveFixture), path.join(archiveFixture, 'disabled-extensions/pi-permission-system'));
  await mkdir(configOnlyExtension, { recursive: true });
  await mkdir(path.join(archivedClone, 'src'), { recursive: true });
  await mkdir(cwd, { recursive: true });
  await cp(path.join(selectedSource, 'index.ts'), path.join(archivedClone, 'index.ts'));
  await cp(path.join(selectedSource, 'src'), path.join(archivedClone, 'src'), { recursive: true });
  await writeFile(path.join(configOnlyExtension, 'config.json'), await readFile('odd/gotgenes-permissions/candidate/config.json'));
  const packageRoot = process.env.GOTGENES_PACKAGE_ROOT ?? path.resolve('odd/gotgenes-permissions/sandbox/package');
  const settings = {
    extensions: ['-builtin:mcp'],
    packages: [{ source: packageRoot }],
  };
  await writeFile(path.join(agentDir, 'settings.json'), JSON.stringify(settings, null, 2));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const pi = await import('/home/piioni/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/index.js');
  const settingsManager = pi.SettingsManager.create(cwd, agentDir);
  const registeredCommands = [];
  const loader = new pi.DefaultResourceLoader({ cwd, agentDir, settingsManager, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: [(api) => api.on('session_start', () => registeredCommands.push(...api.getCommands()))] });
  await loader.reload();
  const loaded = loader.getExtensions();
  const paths = loaded.extensions.map(e => e.path);
  assert.equal(loaded.errors.length, 0, JSON.stringify(loaded.errors));
  assert.equal(paths.filter(p => p.includes('@gotgenes') || p.includes('sandbox/package')).length, 1, JSON.stringify(paths));
  assert.equal(paths.some(p => p.includes('/extensions/pi-permission-system/index.ts')), false, JSON.stringify(paths));
  assert.equal(paths.some(p => p.includes('/disabled-extensions/pi-permission-system/')), false, JSON.stringify(paths));
  const { session } = await pi.createAgentSession({ cwd, agentDir, settingsManager, resourceLoader: loader, sessionManager: pi.SessionManager.inMemory(cwd), tools: [] });
  try {
    await session.bindExtensions({});
    const commandCount = registeredCommands.filter(c => c.name === 'permission-system').length;
    assert.equal(commandCount, 1, `permission-system command count: ${commandCount}`);
    console.log(`loader extensions=${JSON.stringify(paths)}`);
    console.log(`errors=${JSON.stringify(loaded.errors)}; permission-system command count=${commandCount}; mcp disabled; model calls=0`);
  } finally {
    session.dispose();
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
