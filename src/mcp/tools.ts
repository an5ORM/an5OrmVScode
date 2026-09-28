/**
 * AN5 ORM tool definitions exposed over MCP.
 *
 * Read-only tools are annotated with `readOnlyHint` so VS Code runs them without
 * a confirmation prompt. Anything that writes — to the database or to the
 * workspace — deliberately omits that hint *and* requires an explicit
 * `confirm: true` argument, so a model cannot trigger a schema change by
 * accident even if the confirmation dialog is bypassed.
 */
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { McpTool } from './protocol';
import { analyzeSchema, parseSchemaFiles, An5Model } from './schema-reader';
import { resolveWorkspace, Workspace } from './workspace';

const CONFIRM_HELP =
  'Must be true. This changes the database or writes files, so the user must have confirmed it.';

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Reads and parses every `.an5` file in the workspace. */
function loadModels(ws: Workspace): An5Model[] {
  if (ws.schemaFiles.length === 0) {
    throw new Error(
      `No .an5 schema files found under "${ws.root}". Create an ${ws.config.schemaDir ? `"${String(ws.config.schemaDir)}"` : '"an5Schema"'} directory or run "AN5: Generate Client Code" from an existing schema.`,
    );
  }
  return parseSchemaFiles(
    ws.schemaFiles.map((file) => ({ path: file, contents: fs.readFileSync(file, 'utf8') })),
  );
}

/** Runs an npm script from the installed `@an5/orm` and captures its output. */
function runOrmScript(ws: Workspace, script: string, args: string[] = []): Promise<string> {
  if (!ws.ormDir) {
    throw new Error(
      'Could not locate @an5/orm. Install it in this project (npm install @an5/orm) so schema operations can run.',
    );
  }

  return new Promise((resolve, reject) => {
    execFile(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['run', script, ...args],
      { cwd: ws.ormDir, maxBuffer: 10 * 1024 * 1024, env: { ...process.env } },
      (err, stdout, stderr) => {
        const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
        if (err) {
          reject(new Error(`npm run ${script} failed (exit ${err.code ?? '?'}):\n${output || err.message}`));
          return;
        }
        resolve(output || `npm run ${script} completed with no output.`);
      },
    );
  });
}

/** Throws unless the caller explicitly confirmed a mutating operation. */
function assertConfirmed(toolName: string, args: Record<string, unknown>): void {
  if (args.confirm === true) return;
  throw new Error(
    `${toolName} changes the database or the workspace. Re-run with confirm: true once the user has approved it.`,
  );
}

/**
 * Loads the project's `@an5/adapters` so database tools use the same runtime as
 * the rest of the project instead of a duplicate implementation.
 */
function loadAdapters(ws: Workspace): { createAn5Adapter: (opts: Record<string, unknown>) => Promise<any> } {
  if (!ws.connectionString) {
    throw new Error('No DATABASE_URL found. Set it in the environment or in the project .env file.');
  }
  const candidates = [
    path.join(ws.root, 'node_modules', '@an5', 'adapters'),
    path.join(ws.ormDir ?? path.join(ws.root, 'node_modules', '@an5', 'orm'), '..', 'adapters'),
  ];
  const adaptersDir = candidates.find((dir) => fs.existsSync(path.join(dir, 'package.json')));
  if (!adaptersDir) {
    throw new Error('Could not locate @an5/adapters. Install it with: npm install @an5/adapters');
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(adaptersDir);
}

export function createTools(resolve: () => Workspace = () => resolveWorkspace()): McpTool[] {
  const readOnly = { readOnlyHint: true, openWorldHint: false };

  return [
    {
      name: 'an5_list_models',
      description:
        'List every model defined in the project .an5 schema files, with its physical table, field count and relation count. Start here to discover what data the project models.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'List AN5 models', ...readOnly },
      async handler() {
        const models = loadModels(resolve());
        return json({
          schemaDir: path.relative(resolve().root, resolve().schemaDir) || '.',
          totalModels: models.length,
          models: models.map((m) => ({
            name: m.name,
            table: `${m.schemaName}.${m.tableName}`,
            fields: m.fields.length,
            relations: m.relations.length,
            description: m.description,
          })),
        });
      },
    },

    {
      name: 'an5_describe_model',
      description:
        'Describe one model: every field with its SQL type, nullability, key and default, plus its relations. Use before writing queries or code against a model.',
      inputSchema: {
        type: 'object',
        properties: { model: { type: 'string', description: 'Model name, e.g. "User"' } },
        required: ['model'],
      },
      annotations: { title: 'Describe an AN5 model', ...readOnly },
      async handler(args) {
        const name = String(args.model);
        const models = loadModels(resolve());
        const model = models.find((m) => m.name.toLowerCase() === name.toLowerCase());
        if (!model) {
          throw new Error(
            `Unknown model "${name}". Available: ${models.map((m) => m.name).join(', ') || 'none'}`,
          );
        }
        return json({
          name: model.name,
          table: `${model.schemaName}.${model.tableName}`,
          description: model.description,
          fields: model.fields.map((f) => ({
            name: f.name,
            sqlType: f.sqlType,
            optional: f.isOptional,
            primaryKey: f.isId,
            unique: f.isUnique,
            hasDefault: f.hasDefault,
            description: f.description,
          })),
          relations: model.relations.map((r) => ({
            name: r.name,
            target: r.target,
            kind: r.isArray ? 'one-to-many' : 'many-to-one',
            foreignKey: r.foreignKey,
            localKey: r.localKey,
          })),
        });
      },
    },

    {
      name: 'an5_get_relations',
      description:
        'Return the relation graph between models, including the foreign key and local key columns. Use it to work out how to join tables.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'Get AN5 relations', ...readOnly },
      async handler() {
        const models = loadModels(resolve());
        const edges = models.flatMap((model) =>
          model.relations.map((r) => ({
            from: model.name,
            field: r.name,
            to: r.target,
            kind: r.isArray ? 'one-to-many' : 'many-to-one',
            foreignKey: r.foreignKey,
            localKey: r.localKey,
          })),
        );
        return json({ totalRelations: edges.length, relations: edges });
      },
    },

    {
      name: 'an5_analyze_schema',
      description:
        'Review the schema for design problems: missing primary keys, unindexed foreign keys, missing audit timestamps and unique candidates. Read-only.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'Analyze AN5 schema', ...readOnly },
      async handler() {
        return json(analyzeSchema(loadModels(resolve())));
      },
    },

    {
      name: 'an5_read_schema_file',
      description:
        'Return the raw contents of a .an5 schema file. Use it to see the exact declarations, including attributes the structured tools do not surface.',
      inputSchema: {
        type: 'object',
        properties: { file: { type: 'string', description: 'Path to a .an5 file' } },
        required: ['file'],
      },
      annotations: { title: 'Read an AN5 schema file', ...readOnly },
      async handler(args) {
        const ws = resolve();
        const target = path.resolve(ws.root, String(args.file));
        // Refuse to read outside the workspace: this tool takes a path from a model.
        if (!target.startsWith(path.resolve(ws.root))) {
          throw new Error('Path is outside the workspace root.');
        }
        if (!fs.existsSync(target)) {
          throw new Error(
            `File not found: ${target}. Known schema files: ${ws.schemaFiles.map((f) => path.relative(ws.root, f)).join(', ')}`,
          );
        }
        return fs.readFileSync(target, 'utf8');
      },
    },

    {
      name: 'an5_query_database',
      description:
        'Run a read-only SELECT against the database configured by DATABASE_URL and return the rows. Statements other than SELECT are rejected.',
      inputSchema: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'A single SELECT statement' },
        },
        required: ['sql'],
      },
      annotations: { title: 'Query the AN5 database', ...readOnly },
      async handler(args) {
        const sql = String(args.sql).trim();
        if (!/^select\b/i.test(sql)) {
          throw new Error('Only SELECT statements are allowed. Use an5_push_schema or an5_migrate to change data.');
        }
        if (/;\s*\S/.test(sql)) {
          throw new Error('Multiple statements are not allowed in one call.');
        }

        const ws = resolve();
        const { createAn5Adapter } = loadAdapters(ws);
        const adapter = await createAn5Adapter({ connectionString: ws.connectionString });
        try {
          await adapter.$connect();
          const rows = await adapter.exec(sql, {});
          return json({ rowCount: Array.isArray(rows) ? rows.length : undefined, rows });
        } finally {
          await adapter.$disconnect().catch(() => undefined);
        }
      },
    },

    {
      name: 'an5_describe_table',
      description:
        'Describe a table: prefer the .an5 model when one exists, otherwise read the live column metadata from the database.',
      inputSchema: {
        type: 'object',
        properties: { table: { type: 'string', description: 'Table name, e.g. "users" or "User"' } },
        required: ['table'],
      },
      annotations: { title: 'Describe an AN5 table', ...readOnly },
      async handler(args) {
        const table = String(args.table);
        const models = loadModels(resolve());
        const model = models.find(
          (m) =>
            m.name.toLowerCase() === table.toLowerCase() ||
            m.tableName.toLowerCase() === table.toLowerCase(),
        );
        if (model) {
          return json({
            source: 'schema',
            name: model.name,
            table: `${model.schemaName}.${model.tableName}`,
            columns: model.fields.map((f) => ({
              name: f.name,
              type: f.sqlType,
              nullable: f.isOptional,
              primaryKey: f.isId,
            })),
          });
        }

        const ws = resolve();
        const { createAn5Adapter } = loadAdapters(ws);
        const adapter = await createAn5Adapter({ connectionString: ws.connectionString });
        try {
          await adapter.$connect();
          const result = await adapter.table(table).describe();
          return json({ source: 'database', ...result });
        } finally {
          await adapter.$disconnect().catch(() => undefined);
        }
      },
    },

    {
      name: 'an5_database_health',
      description:
        'Report connectivity to the configured database: connected state, latency and adapter in use. Use it to confirm DATABASE_URL works before running queries.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'Check AN5 database health', ...readOnly },
      async handler() {
        const ws = resolve();
        if (!ws.connectionString) {
          return json({ connected: false, error: 'No DATABASE_URL configured.' });
        }
        const started = Date.now();
        const { createAn5Adapter } = loadAdapters(ws);
        const adapter = await createAn5Adapter({ connectionString: ws.connectionString });
        try {
          await adapter.$connect();
          return json({ connected: true, latencyMs: Date.now() - started });
        } catch (err) {
          return json({ connected: false, error: err instanceof Error ? err.message : String(err) });
        } finally {
          await adapter.$disconnect().catch(() => undefined);
        }
      },
    },

    {
      name: 'an5_generate_client',
      description:
        'Generate typed client code from the .an5 schema for TypeScript, Python, .NET, Go or Rust using the installed @an5/orm generator. Writes files to the workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          language: {
            type: 'string',
            description: 'Target language',
            enum: ['typescript', 'python', 'dotnet', 'golang', 'rust'],
          },
          outputDir: { type: 'string', description: 'Output directory (default: the configured path for that language)' },
          confirm: { type: 'boolean', description: CONFIRM_HELP, default: false },
        },
        required: ['language', 'confirm'],
      },
      annotations: {
        title: 'Generate AN5 client code', destructiveHint: false, openWorldHint: false },
      async handler(args) {
        assertConfirmed('an5_generate_client', args);
        return runOrmScript(resolve(), 'generate');
      },
    },

    {
      name: 'an5_push_schema',
      description:
        'Create tables and missing columns in the database from the .an5 schema. This modifies the database; only run it after the user has reviewed the change.',
      inputSchema: {
        type: 'object',
        properties: {
          confirm: { type: 'boolean', description: CONFIRM_HELP, default: false },
        },
        required: ['confirm'],
      },
      annotations: {
        title: 'Push AN5 schema to the database', destructiveHint: true, openWorldHint: true },
      async handler(args) {
        assertConfirmed('an5_push_schema', args);
        return runOrmScript(resolve(), 'db:push');
      },
    },

    {
      name: 'an5_pull_schema',
      description:
        'Introspect the database and write .an5 files that match it, overwriting schema files. Run this only when the database is the source of truth.',
      inputSchema: {
        type: 'object',
        properties: {
          confirm: { type: 'boolean', description: CONFIRM_HELP, default: false },
        },
        required: ['confirm'],
      },
      annotations: {
        title: 'Pull AN5 schema from the database', destructiveHint: true, openWorldHint: true },
      async handler(args) {
        assertConfirmed('an5_pull_schema', args);
        return runOrmScript(resolve(), 'db:pull');
      },
    },

    {
      name: 'an5_migrate',
      description:
        'Run a migration action: diff, generate, apply, rollback or status. apply and rollback change data, so they must be confirmed explicitly.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'Migration action',
            enum: ['diff', 'generate', 'apply', 'rollback', 'status'],
          },
          steps: { type: 'number', description: 'Number of migrations to roll back' },
          dryRun: { type: 'boolean', description: 'Preview SQL without executing it', default: false },
          confirm: { type: 'boolean', description: CONFIRM_HELP, default: false },
        },
        required: ['action', 'confirm'],
      },
      annotations: {
        title: 'Run an AN5 migration action', destructiveHint: true, openWorldHint: true },
      async handler(args) {
        const action = String(args.action);
        const mutating = action === 'apply' || action === 'rollback';
        // read-only actions still require confirmation so the model states intent
        if (mutating) {
          assertConfirmed('an5_migrate', args);
        } else if (args.confirm !== true) {
          throw new Error(`Pass confirm: true to run the "${action}" migration action.`);
        }

        const ws = resolve();
        const extra: string[] = [];
        if (mutating && args.dryRun === true) extra.push('--', '--dry-run');
        if (action === 'rollback' && typeof args.steps === 'number') {
          extra.push('--', String(args.steps));
        }
        return runOrmScript(ws, `db:migrate:${action}`, extra);
      },
    },

    {
      name: 'an5_seed',
      description: 'Insert the ORM default seed data into the database. Run only when the user asks for it.',
      inputSchema: {
        type: 'object',
        properties: {
          confirm: { type: 'boolean', description: CONFIRM_HELP, default: false },
        },
        required: ['confirm'],
      },
      annotations: {
        title: 'Seed the AN5 database', destructiveHint: true, openWorldHint: true },
      async handler(args) {
        assertConfirmed('an5_seed', args);
        return runOrmScript(resolve(), 'db:seed');
      },
    },
  ];
}
