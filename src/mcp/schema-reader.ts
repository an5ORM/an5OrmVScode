/**
 * Schema access for the MCP tools.
 *
 * `@an5/orm` is the single source of truth for parsing `.an5` files, so the
 * installed generator is used whenever the project has it — that is what keeps
 * these tools in step with the code the project actually generates. The local
 * parser below is a degraded fallback for a workspace that has not installed
 * the ORM yet; it understands the same syntax and is covered by the same tests.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseSchemaFiles as parseLocally, An5Field, An5Model, An5Relation } from './fallback-parser';
import { resolveWorkspace, Workspace } from './workspace';

export type { An5Field, An5Model, An5Relation };

/**
 * The slice of `@an5/orm`'s generator API this file uses.
 *
 * Spelled out here rather than as `typeof import('@an5/orm/generator')`. The
 * ORM is located in the workspace at runtime and is deliberately not a
 * dependency of this extension, so a type-level import of it would make `tsc`
 * fail in any checkout without a sibling an5Orm — including this repository's
 * own CI, which checks out an5OrmVScode alone. The runtime lookup already
 * degrades to the fallback parser; the types should not be stricter than that.
 */
interface GeneratorApi {
  SchemaParser: new (schemaDir: string, provider?: string) => { parse(): Promise<unknown> };
  /** Resolves the provider from the project's config; absent before it existed. */
  providerForProject?: (cwd?: string, env?: Record<string, string | undefined>) => string;
  detectProvider?: (connectionString?: string) => string;
}

/** Loads the shared generator when the workspace provides it. */
function loadGenerator(ws: Workspace): GeneratorApi | null {
  if (!ws.ormDir) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(path.join(ws.ormDir, 'dist', 'generator', 'src', 'api.js')) as GeneratorApi;
  } catch {
    return null;
  }
}

/**
 * Parses the workspace schema, preferring the ORM's own parser.
 *
 * `SchemaParser` is async and reads a directory, so this wraps it; the fallback
 * is synchronous and works from already-loaded file contents.
 */
export async function loadSchemaModels(ws: Workspace = resolveWorkspace()): Promise<An5Model[]> {
  if (ws.schemaFiles.length === 0) {
    throw new Error(
      `No .an5 schema files found under "${ws.root}". Create an ${ws.config.schemaDir ? `"${String(ws.config.schemaDir)}"` : '"an5Schema"'} directory or run "AN5: Generate Client Code" from an existing schema.`,
    );
  }

  const generator = loadGenerator(ws);
  if (generator) {
    // The ORM validates field types per provider. Without this, a schema written
    // for PostgreSQL or SQLite is read as SQL Server and every other MCP tool
    // reports it as broken.
    const provider = ws.connectionString && /^(sqlite:|:memory:$)/i.test(ws.connectionString) ? 'sqlite'
      : ws.connectionString && generator.detectProvider ? generator.detectProvider(ws.connectionString)
      : generator.providerForProject?.(ws.root, { ...process.env, ...(ws.connectionString ? { DATABASE_URL: ws.connectionString } : {}) });
    // The shared parser reads one directory, while discovery also finds nested files.
    // Parse the complete discovered set together so cross-file relations are resolved.
    let scratch: string | undefined;
    let models: unknown;
    try {
      if (ws.schemaFiles.some(file => path.dirname(file) !== ws.schemaDir)) {
        scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-schema-reader-'));
        ws.schemaFiles.forEach((file, index) => fs.copyFileSync(file, path.join(scratch!, `${index}.an5`)));
      }
      models = await new generator.SchemaParser(scratch || ws.schemaDir, provider).parse();
    } finally { if (scratch) fs.rmSync(scratch, { recursive: true, force: true }); }
    // The generator represents relation targets as `type`, while the fallback
    // and MCP contract use `target`. Keep one shape for both readers.
    const declared = parseLocally(ws.schemaFiles.map(file => ({ path: file, contents: fs.readFileSync(file, 'utf8') })));
    return (models as any[]).map(model => {
      const source = declared.find(m => m.name === model.name);
      return {
        ...model, sourceFile: model.sourceFile || source?.sourceFile,
        fields: model.fields.map((field: any) => {
          const local = source?.fields.find(f => f.name === field.name);
          return { ...field, isUnique: field.isUnique ?? local?.isUnique ?? false, attributes: field.attributes || local?.attributes || [] };
        }),
        relations: model.relations.map((relation: any) => ({ ...relation, target: relation.target || relation.type })),
      };
    });
  }

  return parseLocally(
    ws.schemaFiles.map((file) => ({ path: file, contents: fs.readFileSync(file, 'utf8') })),
  );
}

export { analyzeSchema } from './fallback-parser';

export function qualifiedTable(model: Pick<An5Model, 'schemaName' | 'tableName'>): string {
  return model.schemaName ? `${model.schemaName}.${model.tableName}` : model.tableName;
}
