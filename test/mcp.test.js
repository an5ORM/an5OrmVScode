/**
 * Tests for the AN5 MCP server.
 *
 * Runs without VS Code: the protocol layer is plain JSON-RPC and the tool
 * handlers read from a temporary workspace on disk. The server is exercised as
 * a real child process over stdio so the framing is covered too.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist', 'mcp');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// ─── Manifest wiring ──────────────────────────────────────────────────────────

console.log('\nManifest:');

test('contributes an MCP server definition provider', () => {
  const providers = packageJson.contributes.mcpServerDefinitionProviders;
  assert.ok(Array.isArray(providers) && providers.length > 0, 'Expected mcpServerDefinitionProviders');
  assert.strictEqual(providers[0].id, 'an5McpProvider');
});

test('the provider id matches the one registered in the extension', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
  assert.ok(
    source.includes("MCP_PROVIDER_ID = 'an5McpProvider'"),
    'Extension must register the provider id declared in package.json',
  );
  assert.ok(source.includes('registerMcpServerDefinitionProvider'), 'Expected provider registration');
  assert.ok(source.includes('McpStdioServerDefinition'), 'Expected a stdio server definition');
});

test('declares an MCP configuration command', () => {
  const commands = packageJson.contributes.commands.map((c) => c.command);
  assert.ok(commands.includes('an5.mcp.showConfig'));
  assert.ok(packageJson.activationEvents.includes('onCommand:an5.mcp.showConfig'));
});

test('requires a VS Code version that ships the MCP API', () => {
  assert.strictEqual(packageJson.engines.vscode, '^1.101.0');
});

test('ships the compiled MCP server', () => {
  for (const file of ['server.js', 'protocol.js', 'tools.js', 'workspace.js', 'schema-reader.js']) {
    assert.ok(fs.existsSync(path.join(distDir, file)), `Expected dist/mcp/${file}`);
  }
  const ignore = fs.readFileSync(path.join(root, '.vscodeignore'), 'utf8');
  assert.ok(!ignore.includes('dist/**\n'), 'dist must not be excluded from the package');
});

// ─── Protocol layer ───────────────────────────────────────────────────────────

console.log('\nProtocol:');

const { handleRequest, validateArgs } = require(path.join(distDir, 'protocol.js'));

const tools = require(path.join(distDir, 'tools.js')).createTools(() => {
  throw new Error('workspace not stubbed');
});

const serverOptions = { name: 'an5-orm', version: 'test', tools };

test('initialize reports the server info and tool capability', async () => {
  const res = await handleRequest(
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    serverOptions,
  );
  assert.strictEqual(res.result.serverInfo.name, 'an5-orm');
  assert.ok(res.result.capabilities.tools, 'Expected tools capability');
});

test('notifications get no response', async () => {
  const res = await handleRequest(
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    serverOptions,
  );
  assert.strictEqual(res, null);
});

test('tools/list returns every tool with a JSON Schema', async () => {
  const res = await handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, serverOptions);
  const list = res.result.tools;
  assert.strictEqual(list.length, 13);
  for (const tool of list) {
    assert.ok(tool.name.startsWith('an5_'), `Tool name should be prefixed: ${tool.name}`);
    assert.ok(tool.description && tool.description.length > 20, `${tool.name} needs a description`);
    assert.strictEqual(tool.inputSchema.type, 'object');
  }
});

test('read-only tools are annotated so the client skips confirmation', async () => {
  const res = await handleRequest({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, serverOptions);
  const byName = Object.fromEntries(res.result.tools.map((t) => [t.name, t]));
  for (const name of ['an5_list_models', 'an5_describe_model', 'an5_query_database', 'an5_analyze_schema']) {
    assert.strictEqual(byName[name].annotations.readOnlyHint, true, `${name} should be read-only`);
  }
});

test('mutating tools require confirmation and are not marked read-only', async () => {
  const res = await handleRequest({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, serverOptions);
  const byName = Object.fromEntries(res.result.tools.map((t) => [t.name, t]));
  for (const name of ['an5_push_schema', 'an5_pull_schema', 'an5_migrate', 'an5_seed', 'an5_generate_client']) {
    const tool = byName[name];
    assert.notStrictEqual(tool.annotations.readOnlyHint, true, `${name} must not claim read-only`);
    assert.ok(
      tool.inputSchema.required.includes('confirm'),
      `${name} must require an explicit confirm argument`,
    );
  }
});

test('unknown tools and methods produce protocol errors', async () => {
  const unknownTool = await handleRequest(
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } },
    serverOptions,
  );
  assert.strictEqual(unknownTool.error.code, -32602);

  const unknownMethod = await handleRequest({ jsonrpc: '2.0', id: 6, method: 'nope' }, serverOptions);
  assert.strictEqual(unknownMethod.error.code, -32601);
});

test('argument validation reports missing and mistyped parameters', () => {
  const schema = {
    type: 'object',
    properties: { name: { type: 'string' }, mode: { type: 'string', enum: ['a', 'b'] } },
    required: ['name'],
  };
  const missing = validateArgs(schema, {});
  assert.ok(missing.some((p) => p.includes('"name"')));

  const wrongType = validateArgs(schema, { name: 42 });
  assert.ok(wrongType.some((p) => p.includes('must be a string')));

  const badEnum = validateArgs(schema, { name: 'x', mode: 'c' });
  assert.ok(badEnum.some((p) => p.includes('must be one of')));
});

// ─── Schema reader ────────────────────────────────────────────────────────────

console.log('\nSchema reader:');

const { parseSchemaFiles, analyzeSchema } = require(path.join(distDir, 'schema-reader.js'));

const schemaText = `model User {
  id       NVARCHAR(1000) @id @default(uuid())
  email    NVARCHAR(255) @unique
  posts    Post[]
  @@map("users")
}

model Post {
  id        NVARCHAR(1000) @id
  authorId  NVARCHAR(1000)
  author    User @relation(fields: [authorId], references: [id])
  @@map("posts")
}
`;

test('parses models, fields, attributes and @@map', () => {
  const models = parseSchemaFiles([{ path: 'user.an5', contents: schemaText }]);
  assert.strictEqual(models.length, 2);
  const user = models.find((m) => m.name === 'User');
  assert.strictEqual(user.tableName, 'users');
  assert.strictEqual(user.schemaName, 'dbo');
  const id = user.fields.find((f) => f.name === 'id');
  assert.strictEqual(id.isId, true);
  assert.strictEqual(id.hasDefault, true);
  assert.strictEqual(user.fields.find((f) => f.name === 'email').isUnique, true);
});

test('resolves relation keys across both sides', () => {
  const models = parseSchemaFiles([{ path: 'user.an5', contents: schemaText }]);
  const user = models.find((m) => m.name === 'User');
  const posts = user.relations.find((r) => r.name === 'posts');
  assert.strictEqual(posts.isArray, true);
  assert.strictEqual(posts.foreignKey, 'authorId');
  assert.strictEqual(posts.localKey, 'id');
});

test('analyzeSchema flags missing primary keys and unindexed foreign keys', () => {
  const models = parseSchemaFiles([
    { path: 'x.an5', contents: 'model Widget {\n  ownerId NVARCHAR(10)\n  @@map("widgets")\n}\n' },
  ]);
  const report = analyzeSchema(models);
  assert.strictEqual(report.summary.totalModels, 1);
  const messages = report.issues.map((i) => i.message).join(' | ');
  assert.ok(messages.includes('no primary key'), messages);
  assert.ok(messages.includes('not indexed'), messages);
});

// ─── End-to-end over stdio ────────────────────────────────────────────────────

console.log('\nServer process:');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-mcp-ws-'));
fs.mkdirSync(path.join(workspace, 'an5Schema'));
fs.writeFileSync(path.join(workspace, 'an5Schema', 'user.an5'), schemaText);

function runServer(messages) {
  const input = messages.map((m) => JSON.stringify(m)).join('\n');
  const out = execFileSync('node', [path.join(distDir, 'server.js')], {
    cwd: workspace,
    input: `${input}\n`,
    encoding: 'utf8',
    timeout: 30000,
  });
  return out
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

test('lists models from the workspace it is started in', () => {
  const responses = runServer([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'an5_list_models', arguments: {} } },
  ]);
  const call = responses.find((r) => r.id === 2);
  assert.strictEqual(call.result.isError, false);
  const payload = JSON.parse(call.result.content[0].text);
  assert.strictEqual(payload.totalModels, 2);
});

test('rejects a mutating call that omits confirm', () => {
  const responses = runServer([
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'an5_push_schema', arguments: {} } },
  ]);
  assert.strictEqual(responses[0].result.isError, true);
  assert.ok(responses[0].result.content[0].text.includes('confirm'));
});

test('rejects confirm: false explicitly', () => {
  const responses = runServer([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'an5_push_schema', arguments: { confirm: false } },
    },
  ]);
  assert.strictEqual(responses[0].result.isError, true);
  assert.ok(responses[0].result.content[0].text.includes('confirm: true'));
});

test('refuses non-SELECT statements', () => {
  const responses = runServer([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'an5_query_database', arguments: { sql: 'DELETE FROM users' } },
    },
  ]);
  assert.strictEqual(responses[0].result.isError, true);
  assert.ok(responses[0].result.content[0].text.includes('Only SELECT'));
});

test('refuses to read files outside the workspace', () => {
  const responses = runServer([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'an5_read_schema_file', arguments: { file: '../../../etc/passwd' } },
    },
  ]);
  assert.strictEqual(responses[0].result.isError, true);
  assert.ok(responses[0].result.content[0].text.includes('outside the workspace'));
});

test('replies in request order', () => {
  const responses = runServer([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'an5_get_relations', arguments: {} },
    },
  ]);
  assert.deepStrictEqual(
    responses.map((r) => r.id),
    [1, 2, 3],
  );
});

test('degrades gracefully when the project has no schema', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-mcp-empty-'));
  const input = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'an5_list_models', arguments: {} },
  });
  const out = execFileSync('node', [path.join(distDir, 'server.js')], {
    cwd: empty,
    input: `${input}\n`,
    encoding: 'utf8',
    timeout: 30000,
  });
  const response = JSON.parse(out.split('\n').filter((l) => l.trim())[0]);
  assert.strictEqual(response.result.isError, true);
  assert.ok(response.result.content[0].text.includes('No .an5 schema files'));
  fs.rmSync(empty, { recursive: true, force: true });
});

fs.rmSync(workspace, { recursive: true, force: true });

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
