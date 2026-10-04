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
const pending = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      pending.push(result.then(() => { passed++; console.log(`  ✓ ${name}`); }, err => {
        failed++; console.log(`  ✗ ${name}\n    ${err.message}`);
      }));
      return;
    }
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

test('builds the stdio definition with positional arguments, not an options object', () => {
  // This is the mistake that kept the server from ever appearing: the API is
  // `constructor(label, command, args, env, version)`, and an options object left
  // `label` holding an object and `command` undefined. VS Code validated that
  // inside a `setTimeout`, so the throw was swallowed and nothing surfaced. An
  // options object here is the bug, so it is asserted against on the compiled
  // output rather than described in a comment.
  const compiled = fs.readFileSync(path.join(root, 'dist', 'extension.js'), 'utf8');
  assert.ok(
    !/new\s+(?:vscode\.)?McpStdioServerDefinition\s*\(\s*\{/.test(compiled),
    'McpStdioServerDefinition takes positional arguments, not an options object',
  );
  assert.ok(
    /new\s+(?:vscode\.)?McpStdioServerDefinition\s*\(\s*(?:folders\.length > 1 \? `\$\{spec\.label\} · \$\{folder\.name\}` : )?spec\.label\s*,/.test(compiled),
    'Expected the label to be passed as the first positional argument',
  );
});

test('derives the server version from the manifest instead of repeating it', () => {
  // A constant that drifts from package.json stops VS Code noticing that the
  // tools changed, so the cache nonce has to come from the manifest.
  const source = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
  assert.ok(!/MCP_SERVER_VERSION\s*=\s*'/.test(source), 'Do not hardcode the MCP server version');
});

test('types the MCP API so a wrong call cannot compile', () => {
  // @types/vscode below the version that declares the MCP API is what forced the
  // extension to cast the call away, and the cast is what hid the mistake.
  const minimum = packageJson.devDependencies['@types/vscode'];
  assert.ok(
    minimum === '^1.101.0',
    `Expected @types/vscode to match engines.vscode (^1.101.0), found ${minimum}`,
  );
  const source = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
  assert.ok(
    !/as unknown as \{[^}]*McpStdioServerDefinition/.test(source),
    'Do not cast away the type of McpStdioServerDefinition',
  );
});

test('declares an MCP configuration command', () => {
  const commands = packageJson.contributes.commands.map((c) => c.command);
  assert.ok(commands.includes('an5.mcp.showConfig'));
  assert.ok(
    commands.includes('an5.mcp.install'),
    'Expected a command that writes the server into a config file',
  );
});

test('activates without an AN5 project in the workspace', () => {
  // The MCP provider only exists once the extension activates, and `workspaceContains`
  // alone left the server absent from any workspace that had not been set up yet.
  assert.ok(
    packageJson.activationEvents.includes('onStartupFinished'),
    'Expected onStartupFinished so the MCP provider is registered on startup',
  );
});

test('relies on inferred activation events for its commands', () => {
  assert.ok(!packageJson.activationEvents.some((e) => e.startsWith('onCommand:')));
});

test('requires a VS Code version that ships the MCP API', () => {
  assert.strictEqual(packageJson.engines.vscode, '^1.101.0');
});

test('ships the compiled MCP server', () => {
  for (const file of ['server.js', 'protocol.js', 'tools.js', 'workspace.js', 'schema-reader.js', 'fallback-parser.js']) {
    assert.ok(fs.existsSync(path.join(distDir, file)), `Expected dist/mcp/${file}`);
  }
  const ignore = fs.readFileSync(path.join(root, '.vscodeignore'), 'utf8');
  assert.ok(!ignore.includes('dist/**\n'), 'dist must not be excluded from the package');
});

// ─── Definition and config merge ──────────────────────────────────────────────
//
// Installing used to mean copying a snippet with an unresolved
// `<path-to-extension>` placeholder into `mcp.json` by hand. These cover the two
// things that made that error-prone: the resolved values, and a merge that cannot
// lose a server the user already has.

console.log('\nDefinition:');

const definition = require(path.join(distDir, 'definition.js'));

const extensionPath = path.resolve(root);
const nodePath = '/usr/bin/node';
const projectDir = '/home/dev/project';
const serverPath = definition.serverEntryPath(extensionPath);

test('points at a server entry point that exists in the built extension', () => {
  assert.strictEqual(serverPath, path.join(extensionPath, 'dist', 'mcp', 'server.js'));
  assert.ok(fs.existsSync(serverPath), `Expected ${serverPath} to exist`);
});

test('describes a server VS Code can launch', () => {
  const spec = definition.stdioSpec({ extensionPath, nodePath, cwd: projectDir, version: '1.0.5' });

  assert.strictEqual(spec.label, 'AN5 ORM');
  assert.strictEqual(typeof spec.label, 'string', 'VS Code validates that label is a string');

  // An absolute node binary, not `'node'`: the editor starts the server without a
  // shell, so no PATH the user configured applies, and a version-manager node
  // would not be found.
  assert.strictEqual(spec.command, nodePath);
  assert.ok(path.isAbsolute(spec.command), 'Expected an absolute command path');

  assert.deepStrictEqual(spec.args, [serverPath]);
  assert.ok(fs.existsSync(spec.args[0]), 'Expected the server script to exist');
  assert.strictEqual(spec.cwd, projectDir);
  assert.strictEqual(spec.version, '1.0.5');
});

test('omits the optional parts instead of emitting empty ones', () => {
  const spec = definition.stdioSpec({ extensionPath, nodePath });
  assert.ok(!('cwd' in spec), 'Expected no cwd when no folder is open');
  assert.ok(!('version' in spec), 'Expected no version when the manifest has none');

  const entry = definition.mcpJsonEntry(spec);
  assert.ok(!('cwd' in entry), 'Expected no cwd in the config entry either');
  assert.strictEqual(entry.type, 'stdio');
  assert.strictEqual(entry.command, nodePath);
});

test('keeps each config format under the property it is read from', () => {
  assert.strictEqual(definition.serversKey('.mcp.json'), 'mcpServers');
  assert.strictEqual(definition.serversKey('.vscode/mcp.json'), 'servers');
});

console.log('\nConfig merge:');

const entry = { type: 'stdio', command: nodePath, args: [serverPath], cwd: projectDir };

test('creates the file when there is nothing to merge into', () => {
  const result = definition.mergeServerEntry('', 'an5-orm', entry, '.mcp.json');
  assert.ok(result.created);
  assert.ok(result.changed);
  const parsed = JSON.parse(result.text);
  assert.deepStrictEqual(parsed.mcpServers['an5-orm'], entry);
  assert.ok(result.text.endsWith('\n'), 'Expected a trailing newline');
});

test('keeps the servers already in the file', () => {
  const existing = JSON.stringify(
    { mcpServers: { github: { type: 'http', url: 'https://example.test/mcp' } } },
    null,
    2,
  );
  const parsed = JSON.parse(definition.mergeServerEntry(existing, 'an5-orm', entry, '.mcp.json').text);
  assert.deepStrictEqual(parsed.mcpServers.github, { type: 'http', url: 'https://example.test/mcp' });
  assert.deepStrictEqual(parsed.mcpServers['an5-orm'], entry);
});

test('keeps the other settings in the file', () => {
  const existing = JSON.stringify({ inputs: [{ id: 'token' }], mcpServers: {} }, null, 2);
  const parsed = JSON.parse(definition.mergeServerEntry(existing, 'an5-orm', entry, '.mcp.json').text);
  assert.deepStrictEqual(parsed.inputs, [{ id: 'token' }]);
});

test('writes into the right property for .vscode/mcp.json', () => {
  const parsed = JSON.parse(definition.mergeServerEntry('', 'an5-orm', entry, '.vscode/mcp.json').text);
  assert.deepStrictEqual(parsed.servers['an5-orm'], entry);
  assert.ok(!('mcpServers' in parsed), 'Expected only the VS Code property');
});

test('changes nothing when the entry already matches', () => {
  const existing = `${JSON.stringify({ mcpServers: { 'an5-orm': entry } }, null, 2)}\n`;
  const result = definition.mergeServerEntry(existing, 'an5-orm', entry, '.mcp.json');
  assert.strictEqual(result.changed, false);
  assert.strictEqual(result.text, existing, 'Expected the file to be left byte for byte');
});

test('updates the entry when the server moved to a new extension version', () => {
  const stale = { ...entry, args: ['/home/dev/.vscode/extensions/an5orm.an5-orm-vscode-1.0.4/dist/mcp/server.js'] };
  const existing = `${JSON.stringify({ mcpServers: { 'an5-orm': stale } }, null, 2)}\n`;
  const result = definition.mergeServerEntry(existing, 'an5-orm', entry, '.mcp.json');
  assert.ok(result.changed, 'Expected a stale path to be rewritten');
  assert.deepStrictEqual(JSON.parse(result.text).mcpServers['an5-orm'].args, entry.args);
});

test('refuses to overwrite a file it cannot parse', () => {
  // The file is the user's, and the only way to "fix" unreadable JSON here would
  // be to destroy whatever they were editing — including comments, which
  // JSON.parse cannot see and which users do write in mcp.json.
  const broken = '{ // our servers\n  "mcpServers": {}\n';
  assert.throws(
    () => definition.mergeServerEntry(broken, 'an5-orm', entry, '.mcp.json'),
    (error) => error instanceof definition.McpJsonError && /not valid JSON/.test(error.message),
  );
});

test('refuses to replace a servers property that is not an object', () => {
  assert.throws(
    () => definition.mergeServerEntry('{"mcpServers": []}', 'an5-orm', entry, '.mcp.json'),
    (error) => error instanceof definition.McpJsonError && /not an object/.test(error.message),
  );
});

test('refuses a document that is not a JSON object', () => {
  assert.throws(
    () => definition.mergeServerEntry('[]', 'an5-orm', entry, '.mcp.json'),
    (error) => error instanceof definition.McpJsonError && /top level/.test(error.message),
  );
});

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
  assert.strictEqual(list.length, 14);
  for (const tool of list) {
    assert.ok(tool.name.startsWith('an5_'), `Tool name should be prefixed: ${tool.name}`);
    assert.ok(tool.description && tool.description.length > 20, `${tool.name} needs a description`);
    assert.strictEqual(tool.inputSchema.type, 'object');
  }
});

test('read-only tools are annotated so the client skips confirmation', async () => {
  const res = await handleRequest({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, serverOptions);
  const byName = Object.fromEntries(res.result.tools.map((t) => [t.name, t]));
  for (const name of ['an5_list_models', 'an5_describe_model', 'an5_query_database', 'an5_analyze_schema', 'an5_generate_code']) {
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

console.log('\nFallback schema reader (used when @an5/orm is not installed):');

const { parseSchemaFiles, analyzeSchema } = require(path.join(distDir, 'fallback-parser.js'));

const schemaText = `model User {
  id       NVARCHAR(1000) @id @default(uuid()) @description("Primary key")
  email    NVARCHAR(255) @unique @description("Login email")
  posts    Post[] @description("Everything the user wrote")
  @@map("users")
  @@description("A registered user")
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

test('keeps @description on fields, relations and models', () => {
  const models = parseSchemaFiles([{ path: 'user.an5', contents: schemaText }]);
  const user = models.find((m) => m.name === 'User');
  assert.strictEqual(user.description, 'A registered user');
  assert.strictEqual(user.fields.find((f) => f.name === 'id').description, 'Primary key');
  assert.strictEqual(user.fields.find((f) => f.name === 'email').description, 'Login email');
  assert.strictEqual(user.relations.find((r) => r.name === 'posts').description, 'Everything the user wrote');
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

test('surfaces the relation description through the schema tools', () => {
  const responses = runServer([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'an5_describe_model', arguments: { model: 'User' } },
    },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'an5_get_relations', arguments: {} } },
  ]);

  const described = JSON.parse(responses.find((r) => r.id === 1).result.content[0].text);
  assert.strictEqual(described.description, 'A registered user');
  assert.strictEqual(described.fields.find((f) => f.name === 'email').description, 'Login email');
  assert.strictEqual(described.relations[0].description, 'Everything the user wrote');

  const graph = JSON.parse(responses.find((r) => r.id === 2).result.content[0].text);
  assert.ok(
    graph.relations.some((r) => r.description === 'Everything the user wrote'),
    'get_relations must include relation descriptions',
  );
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

Promise.all(pending).then(() => {
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exitCode = failed > 0 ? 1 : 0;
});
