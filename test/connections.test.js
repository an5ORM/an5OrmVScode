const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { ConnectionStore, providerOf } = require('../dist/connections/store');
const { normalizeConnectionString, testConnection } = require('../dist/connections/runtime');
const { nodeRuntime } = require('../dist/node-runtime');
const { resolveWorkspace } = require('../dist/mcp/workspace');
const { stdioSpec, mcpJsonEntry } = require('../dist/mcp/definition');
function memory() {
  const states = new Map(), secrets = new Map();
  const state = { get: (k, fallback) => states.get(k) || fallback, update: async (k, v) => states.set(k, v) };
  const vault = { get: async k => secrets.get(k), store: async (k, v) => secrets.set(k, v), delete: async k => secrets.delete(k) };
  return { states, secrets, state, vault, store: new ConnectionStore(state, vault) };
}

test('workspace profiles persist metadata without credentials, isolate roots and keep blank edits', async () => {
  const { store, states, secrets } = memory();
  const secret = 'postgresql://review:private-password@localhost/test';
  const p = await store.save('root-a', 'Development', secret);
  await store.activate('root-a', p.id);
  assert.equal(await store.secret('root-a'), secret);
  assert.equal(await store.secret('root-b', p.id), undefined);
  assert.equal(store.list('root-b').profiles.length, 0);
  assert.ok(!JSON.stringify([...states.values()]).includes('private-password'));
  assert.equal(secrets.size, 1);
  await store.save('root-a', 'Renamed', '', p.id);
  assert.equal(await store.secret('root-a'), secret);
  await store.activate('root-a');
  assert.equal(await store.secret('root-a'), undefined);
  await store.activate('root-a', p.id);
  await store.remove('root-a', p.id);
  assert.equal(store.list('root-a').activeId, undefined);
  assert.equal(secrets.size, 0);
});

test('profile validation and serialized writes prevent duplicates and lost edits', async () => {
  const { store } = memory();
  await Promise.all([store.save('a', 'One', ':memory:'), store.save('a', 'Two', 'mysql://user:pass@localhost/db')]);
  assert.equal(store.list('a').profiles.length, 2);
  await assert.rejects(store.save('a', 'one', ':memory:'), /already exists/);
  await assert.rejects(store.save('a', '', ':memory:'));
  await assert.rejects(store.save('a', 'Bad', 'unsupported connection'));
  await assert.rejects(store.save('a', 'Newline', 'postgresql://a\npassword'));
  await assert.rejects(store.save('a', 'Stale', ':memory:', 'missing'));
  await assert.rejects(store.activate('a', 'missing'));
});

test('failed metadata update restores the previous secret', async () => {
  const m = memory();
  const p = await m.store.save('a', 'One', ':memory:');
  m.state.update = async () => { throw new Error('disk unavailable'); };
  await assert.rejects(m.store.save('a', 'One', 'mysql://new-secret@localhost/db', p.id));
  assert.equal(await m.store.secret('a', p.id), ':memory:');
});

test('provider detection and relative SQLite paths match supported adapter formats', () => {
  assert.equal(providerOf('POSTGRESQL://host/db'), 'postgres');
  assert.equal(providerOf('Server=localhost;Database=db;Password=test'), 'mssql');
  assert.equal(providerOf('mariadb://host/db'), 'mysql');
  assert.equal(normalizeConnectionString('/tmp/project', 'sqlite:./test.sqlite'), 'sqlite:/tmp/project/test.sqlite');
  assert.equal(normalizeConnectionString('/tmp/project', 'sqlite::memory:'), ':memory:');
});

test('configuration refresh and DATABASE_URL precedence use the current workspace', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-config-ui-'));
  const old = process.env.DATABASE_URL; delete process.env.DATABASE_URL;
  try {
    const config = path.join(root, 'an5Orm.config.cjs');
    fs.writeFileSync(config, 'module.exports={connectionString:"sqlite:first.sqlite"}');
    assert.equal(resolveWorkspace(root).connectionString, 'sqlite:first.sqlite');
    fs.writeFileSync(config, 'module.exports={connectionString:"sqlite:second.sqlite"}');
    assert.equal(resolveWorkspace(root).connectionString, 'sqlite:second.sqlite');
    fs.writeFileSync(path.join(root, '.env'), 'export DATABASE_URL = "sqlite:env.sqlite" # comment');
    assert.equal(resolveWorkspace(root).connectionString, 'sqlite:env.sqlite');
    process.env.DATABASE_URL = 'sqlite:process.sqlite';
    assert.equal(resolveWorkspace(root).connectionString, 'sqlite:process.sqlite');
  } finally { if (old === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = old; fs.rmSync(root, { recursive: true, force: true }); }
});

test('Electron fallback supplies Node mode in both MCP definitions and installed config', () => {
  const runtime = nodeRuntime(undefined, '/editor/code', { PATH: '' });
  assert.deepEqual(runtime.env, { ELECTRON_RUN_AS_NODE: '1' });
  const entry = mcpJsonEntry(stdioSpec({ extensionPath: '/extension', nodePath: runtime.command, env: runtime.env }));
  assert.equal(entry.env.ELECTRON_RUN_AS_NODE, '1');
  assert.throws(() => nodeRuntime('relative/node'), /absolute/);
});

test('isolated SQLite connection probe succeeds with project adapters', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-probe-'));
  fs.mkdirSync(path.join(root, 'node_modules', '@an5'), { recursive: true });
  fs.symlinkSync(path.resolve(__dirname, '../../an5Adapters'), path.join(root, 'node_modules', '@an5', 'adapters'), 'dir');
  try {
    const result = await testConnection(root, 'sqlite:./probe.sqlite');
    assert.equal(result.provider, 'sqlite');
    assert.ok(fs.existsSync(path.join(root, 'probe.sqlite')));
    const secret = 'mysql://user:must-not-be-reported@127.0.0.1:1/database';
    await assert.rejects(testConnection(root, secret), error => !error.message.includes('must-not-be-reported') && /Connection failed/.test(error.message));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('project command plans keep workspace cwd and do not retry failed scripts', () => {
  const { projectCommand } = require('../dist/project-command');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-command-plan-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'db:migrate:rollback': 'node rollback.js' } }));
    const ws = { root, ormDir: '/dependency/orm', connectionString: 'sqlite:test.sqlite' };
    const plan = projectCommand(ws, 'db:migrate:rollback', ['2', '--dry-run']);
    assert.equal(plan.cwd, root);
    assert.deepEqual(plan.args, ['run', 'db:migrate:rollback', '--', '2', '--dry-run']);
    assert.equal(plan.env.DATABASE_URL, 'sqlite:test.sqlite');
    assert.throws(() => projectCommand(ws, 'db:push'), /does not provide a runnable/);
    const entry = path.join(root, 'orm', 'dist', 'generator', 'src', 'index.js');
    fs.mkdirSync(path.dirname(entry), { recursive: true }); fs.writeFileSync(entry, '');
    const generated = projectCommand({ ...ws, ormDir: path.join(root, 'orm') }, 'generate');
    assert.equal(generated.cwd, root);
    assert.equal(generated.args[0], entry);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('project connections appear without import, refresh file values and isolate config environment', () => {
  const { projectConnection } = require('../dist/connections/project');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-auto-project-'));
  const a = path.join(dir, 'a'), b = path.join(dir, 'b'); fs.mkdirSync(a); fs.mkdirSync(b);
  const old = process.env.DATABASE_URL; delete process.env.DATABASE_URL;
  const oldCustom = process.env.AN5_REVIEW_CUSTOM; delete process.env.AN5_REVIEW_CUSTOM;
  try {
    fs.writeFileSync(path.join(a, '.env'), 'DATABASE_URL=sqlite:first.sqlite\nAN5_REVIEW_CUSTOM=mysql://user:private-secret@localhost/a');
    fs.writeFileSync(path.join(a, 'an5Orm.config.js'), 'process.env.DATABASE_URL="sqlite:contamination.sqlite"; module.exports={connectionString:process.env.AN5_REVIEW_CUSTOM};');
    fs.writeFileSync(path.join(b, 'an5Orm.config.cjs'), 'module.exports={connectionString:"postgresql://user:private-secret@localhost/b"};');
    const first = projectConnection(a);
    assert.equal(first.profile.project, true);
    assert.equal(first.profile.source, '.env');
    assert.equal(first.connectionString, 'sqlite:first.sqlite');
    assert.equal(process.env.DATABASE_URL, undefined);
    assert.equal(process.env.AN5_REVIEW_CUSTOM, undefined);
    assert.ok(!JSON.stringify(first.profile).includes('private-secret'));
    assert.equal(projectConnection(b).profile.source, 'an5Orm.config.cjs');
    assert.equal(projectConnection(b).profile.provider, 'postgres');
    fs.writeFileSync(path.join(a, '.env'), 'DATABASE_URL=sqlite:updated.sqlite');
    assert.equal(projectConnection(a).connectionString, 'sqlite:updated.sqlite');
    fs.unlinkSync(path.join(a, '.env'));
    fs.writeFileSync(path.join(a, 'an5Orm.config.js'), 'module.exports={connectionString:"sqlite:config.sqlite"};');
    assert.equal(projectConnection(a).profile.source, 'an5Orm.config.js');
    assert.equal(projectConnection(a).connectionString, 'sqlite:config.sqlite');
    fs.unlinkSync(path.join(a, 'an5Orm.config.js'));
    assert.equal(projectConnection(a), undefined);
  } finally {
    if (old === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = old;
    if (oldCustom === undefined) delete process.env.AN5_REVIEW_CUSTOM; else process.env.AN5_REVIEW_CUSTOM = oldCustom;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('configured subprojects are discovered without dependency folders or symlink traversal', () => {
  const { projectRoots } = require('../dist/connections/project');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-project-roots-'));
  try {
    for (const rel of ['apps/example', 'node_modules/ignored', 'external']) {
      const full = path.join(dir, rel); fs.mkdirSync(full, { recursive: true });
      fs.writeFileSync(path.join(full, 'an5Orm.config.js'), 'throw Error("Discovery must not execute config")');
    }
    fs.symlinkSync(path.join(dir, 'external'), path.join(dir, 'linked'), 'dir');
    const roots = projectRoots(dir);
    assert.ok(roots.includes(dir)); assert.ok(roots.includes(path.join(dir, 'apps/example')));
    assert.ok(!roots.includes(path.join(dir, 'node_modules/ignored')));
    assert.ok(!roots.includes(path.join(dir, 'linked')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
