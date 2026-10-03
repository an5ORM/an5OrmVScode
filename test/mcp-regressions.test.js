const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveWorkspace } = require('../dist/mcp/workspace');
const { createTools } = require('../dist/mcp/tools');
const { assertSelectQuery } = require('../dist/mcp/select-query');

test('SELECT guard distinguishes SQL from quoted text and comments', () => {
  for (const sql of ["SELECT ';DELETE' AS value; -- end", '/* comment */ SELECT 1', 'SELECT $$; DELETE$$', 'SELECT [into] FROM [update]']) assert.doesNotThrow(() => assertSelectQuery(sql));
  for (const sql of ['SELECT 1; DELETE FROM users', 'SELECT * INTO copy FROM users', "SELECT 1 INTO OUTFILE '/tmp/file'", 'SELECT * FROM users FOR UPDATE', "SELECT 'unclosed", 'SELECT 1 /* unclosed', 'SELECT 1 /*! INTO copy */']) assert.throws(() => assertSelectQuery(sql));
});

test('MCP uses supplied workspace, blocks sibling prefixes and symlink escapes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-mcp-fix-'));
  const root = path.join(dir, 'project');
  const sibling = root + '-other';
  fs.mkdirSync(root); fs.mkdirSync(sibling);
  fs.mkdirSync(path.join(root, 'an5Schema'));
  fs.writeFileSync(path.join(root, 'an5Schema', 'model.an5'), 'model WorkspaceOnly {\n id INT @id\n}\n');
  fs.writeFileSync(path.join(sibling, 'outside.an5'), 'outside');
  fs.symlinkSync(path.join(sibling, 'outside.an5'), path.join(root, 'escape.an5'));
  fs.writeFileSync(path.join(root, '.env'), 'PRIVATE=value');
  const tools = Object.fromEntries(createTools(() => resolveWorkspace(root)).map(t => [t.name, t]));
  try {
    const result = JSON.parse(await tools.an5_list_models.handler({}));
    assert.equal(result.models[0].name, 'WorkspaceOnly');
    for (const file of [path.join(sibling, 'outside.an5'), 'escape.an5', '.env']) await assert.rejects(tools.an5_read_schema_file.handler({ file }));
    assert.match(await tools.an5_read_schema_file.handler({ file: 'an5Schema/model.an5' }), /WorkspaceOnly/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('live table description works with SQLite and no schema files', async () => {
  const { createAn5Adapter } = require('@an5/adapters');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-mcp-db-'));
  const connectionString = path.join(dir, 'test.sqlite');
  const adapter = createAn5Adapter({ connectionString });
  const child = path.join(dir, 'nested'); fs.mkdirSync(child);
  const ws = { ...resolveWorkspace(child), connectionString, ormDir: undefined };
  fs.mkdirSync(path.join(dir, 'node_modules', '@an5'), { recursive: true });
  fs.symlinkSync(path.dirname(path.dirname(require.resolve('@an5/adapters'))), path.join(dir, 'node_modules', '@an5', 'adapters'), 'dir');
  try {
    await adapter.exec('CREATE TABLE custom (key INTEGER PRIMARY KEY, value TEXT DEFAULT \'x\')');
    const tool = createTools(() => ws).find(t => t.name === 'an5_describe_table');
    const result = JSON.parse(await tool.handler({ table: 'custom' }));
    assert.equal(result.source, 'database');
    assert.equal(result.columns[0].isPrimaryKey, true);
    assert.equal(result.columns[0].isNullable, false);
    assert.equal(result.columns[1].defaultValue, "'x'");
  } finally { await adapter.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); }
});


test('schema reader loads the installed generator module rather than package properties', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-mcp-parser-'));
  const apiDir = path.join(dir, 'orm/dist/generator/src');
  fs.mkdirSync(apiDir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'an5Schema'));
  fs.writeFileSync(path.join(dir, 'an5Schema/model.an5'), 'invalid local schema');
  fs.writeFileSync(path.join(apiDir, 'api.js'), `exports.providerForProject = () => 'sqlite';
    exports.SchemaParser = class { constructor(dir, provider) { if (provider !== 'sqlite') throw Error('Wrong provider'); }
      async parse() { return [{ name: 'FromInstalledGenerator', schemaName: 'main', tableName: 'real', fields: [], relations: [] }]; } };`);
  try {
    const ws = { ...resolveWorkspace(dir), ormDir: path.join(dir, 'orm') };
    const result = JSON.parse(await createTools(() => ws).find(t => t.name === 'an5_list_models').handler({}));
    assert.equal(result.models[0].name, 'FromInstalledGenerator');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('installed ORM schema models preserve relation targets, unique fields and schema-less table names', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-real-parser-'));
  fs.mkdirSync(path.join(dir, 'an5Schema'));
  fs.writeFileSync(path.join(dir, 'an5Schema', 'models.an5'), `model User {
    id INTEGER @id
    email TEXT @unique
    posts Post[]
    @@map("users")
  }
  model Post {
    id INTEGER @id
    authorId INTEGER
    author User @relation(fields: [authorId], references: [id])
  }`);
  try {
    fs.mkdirSync(path.join(dir, 'an5Schema', 'nested'));
    fs.writeFileSync(path.join(dir, 'an5Schema', 'nested', 'other.an5'), 'model Nested {\n id INTEGER @id\n}');
    const ws = { ...resolveWorkspace(dir), ormDir: path.dirname(require.resolve('@an5/orm/package.json')), connectionString: 'sqlite::memory:' };
    const tools = Object.fromEntries(createTools(() => ws).map(t => [t.name, t]));
    const listed = JSON.parse(await tools.an5_list_models.handler({}));
    assert.equal(listed.totalModels, 3, 'Nested schema files must not be silently omitted');
    const user = JSON.parse(await tools.an5_describe_model.handler({ model: 'User' }));
    assert.equal(user.table, 'users');
    assert.equal(user.fields.find(f => f.name === 'email').unique, true);
    assert.equal(user.relations[0].target, 'Post');
    const graph = JSON.parse(await tools.an5_get_relations.handler({}));
    assert.ok(graph.relations.every(r => r.to));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('migration script runs in workspace with a single argument delimiter and selected environment', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-mcp-command-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { 'db:migrate:rollback': 'node inspect.js' } }));
  fs.writeFileSync(path.join(dir, 'inspect.js'), 'console.log("AN5_ARGS=" + JSON.stringify(process.argv.slice(2))); console.log("AN5_ROOT=" + process.cwd()); console.log("AN5_ENV=" + process.env.DATABASE_URL);');
  try {
    const ws = { ...resolveWorkspace(dir), ormDir: undefined, connectionString: 'sqlite:temporary.sqlite' };
    const tool = createTools(() => ws).find(t => t.name === 'an5_migrate');
    const result = await tool.handler({ action: 'rollback', steps: 2, dryRun: true, confirm: true });
    assert.match(result, /AN5_ARGS=\["--dry-run","2"\]/);
    assert.ok(result.includes(`AN5_ROOT=${dir}`));
    assert.ok(result.includes('AN5_ENV=sqlite:temporary.sqlite'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('MCP generation honors language/output and rejects symlink escapes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-mcp-generation-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-mcp-outside-'));
  fs.mkdirSync(path.join(dir, 'an5Schema'));
  fs.writeFileSync(path.join(dir, 'an5Schema', 'model.an5'), 'model Example {\n id INTEGER @id\n value TEXT\n}');
  fs.mkdirSync(path.join(dir, 'untouched')); fs.writeFileSync(path.join(dir, 'untouched', 'keep.ts'), 'do not modify');
  fs.symlinkSync(outside, path.join(dir, 'escape'), 'dir');
  const ws = { ...resolveWorkspace(dir), ormDir: path.dirname(require.resolve('@an5/orm/package.json')), connectionString: 'sqlite::memory:', config: { outputs: { typescript: { outputDir: 'untouched', metadataFile: 'untouched/metadata.ts' } } } };
  const tool = createTools(() => ws).find(t => t.name === 'an5_generate_client');
  try {
    const result = JSON.parse(await tool.handler({ language: 'python', outputDir: 'generated/python', confirm: true }));
    assert.equal(result.language, 'python');
    assert.ok(fs.existsSync(path.join(dir, 'generated/python/an5_metadata.py')));
    assert.equal(fs.readFileSync(path.join(dir, 'untouched/keep.ts'), 'utf8'), 'do not modify');
    assert.equal(fs.readdirSync(path.join(dir, 'untouched')).length, 1);
    await assert.rejects(tool.handler({ language: 'typescript', outputDir: 'escape/generated', confirm: true }), /symlinks/);
    assert.equal(fs.readdirSync(outside).length, 0);
    await assert.rejects(tool.handler({ language: 'rust', outputDir: '../escape', confirm: true }), /inside the workspace/);
    await assert.rejects(tool.handler({ language: 'python', confirm: false }), /confirm: true/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});
