/**
 * AN5 ORM MCP server (stdio).
 *
 * Spawned by VS Code with the user's workspace as the working directory, or run
 * directly by any other MCP client:
 *
 *   node dist/mcp/server.js
 *
 * stdout carries MCP traffic only; diagnostics go to stderr so they never
 * corrupt the protocol stream.
 */
import { startStdioServer } from './protocol';
import { createTools } from './tools';
import { resolveWorkspace } from './workspace';

const SERVER_NAME = 'an5-orm';
const SERVER_VERSION: string = require('../../package.json').version;

function log(message: string): void {
  process.stderr.write(`[an5-orm-mcp] ${message}\n`);
}

function main(): void {
  let workspaceRoot = process.cwd();
  let workspaceError: string | undefined;

  // Resolve the workspace once at startup so a broken setup is reported through
  // the tool results instead of the server refusing to start.
  try {
    const ws = resolveWorkspace(workspaceRoot);
    workspaceRoot = ws.root;
    if (ws.schemaFiles.length === 0) {
      workspaceError = `No .an5 schema files found in "${ws.root}".`;
      log(workspaceError);
    } else {
      log(`schema: ${ws.schemaFiles.length} file(s), orm: ${ws.ormDir ?? 'not found'}, database: ${ws.connectionString ? 'configured' : 'not configured'}`);
    }
  } catch (err) {
    workspaceError = err instanceof Error ? err.message : String(err);
    log(`workspace discovery failed: ${workspaceError}`);
  }

  startStdioServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    instructions: [
      'AN5 ORM tools for a schema-driven project.',
      'Call an5_list_models first to discover the data model, then an5_describe_model before writing queries or code.',
      'Database tools read DATABASE_URL from the environment or the project .env file.',
      'Tools that change the database or write files require an explicit confirm: true argument, so ask the user before calling them.',
      workspaceError ? `Workspace note: ${workspaceError}` : undefined,
    ]
      .filter(Boolean)
      .join(' '),
    tools: createTools(() => resolveWorkspace(workspaceRoot)),
    log,
  });
}

main();
