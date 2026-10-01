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
import { parseSchemaFiles as parseLocally, An5Field, An5Model, An5Relation } from './fallback-parser';
import { resolveWorkspace } from './workspace';

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
  SchemaParser: new (schemaDir: string) => { parse(): Promise<unknown> };
}

/** Loads the shared generator when the workspace provides it. */
function loadGenerator(): GeneratorApi | null {
  const ws = resolveWorkspace();
  if (!ws.ormDir) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(ws.ormDir)['./dist/generator/src/api.js'] as GeneratorApi;
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
export async function loadSchemaModels(): Promise<An5Model[]> {
  const ws = resolveWorkspace();
  if (ws.schemaFiles.length === 0) {
    throw new Error(
      `No .an5 schema files found under "${ws.root}". Create an ${ws.config.schemaDir ? `"${String(ws.config.schemaDir)}"` : '"an5Schema"'} directory or run "AN5: Generate Client Code" from an existing schema.`,
    );
  }

  const generator = loadGenerator();
  if (generator) {
    const models = await new generator.SchemaParser(ws.schemaDir).parse();
    return models as unknown as An5Model[];
  }

  return parseLocally(
    ws.schemaFiles.map((file) => ({ path: file, contents: fs.readFileSync(file, 'utf8') })),
  );
}

export { analyzeSchema } from './fallback-parser';
