/**
 * Describes the MCP server this extension ships, in the two shapes VS Code needs.
 *
 * Nothing here imports `vscode`, deliberately. A `McpStdioServerDefinition` can
 * only be constructed inside the extension host, where nothing runs without
 * launching VS Code — which is how the definition stayed wrong for so long: the
 * constructor was called with an options object while the API is positional, and
 * the only tests were substring matches over `extension.ts`, so they passed.
 *
 * The values are therefore computed here as plain data and tested here. The
 * extension host only wraps them in the real class at the very edge.
 */
import * as path from 'path';

/** Key the server is written under in a config file. */
export const MCP_SERVER_KEY = 'an5-orm';

/** Label VS Code shows in `MCP: List Servers`. */
export const MCP_SERVER_LABEL = 'AN5 ORM';

/** A stdio server, as plain data. Mirrors `vscode.McpStdioServerDefinition`. */
export interface StdioServerSpec {
  label: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  version?: string;
}

/** The shape a single server takes in a VS Code `mcp.json`. */
export interface McpJsonEntry {
  type: 'stdio';
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface SpecOptions {
  /** Absolute path of the installed extension directory. */
  extensionPath: string;
  /** Absolute path of the node binary to run the server with. */
  nodePath: string;
  /** Explicit runtime environment; secret profiles are injected only at launch. */
  env?: Record<string, string>;
  /** Workspace directory the server should discover the project from. */
  cwd?: string;
  /** Extension version, passed so a server upgrade prompts a tool refresh. */
  version?: string;
}

/**
 * Absolute path of the compiled MCP server inside the installed extension.
 *
 * `dist/mcp/server.js` is the only entry point; the rest of `dist/mcp` is
 * required by it.
 */
export function serverEntryPath(extensionPath: string): string {
  return path.join(extensionPath, 'dist', 'mcp', 'server.js');
}

/**
 * Builds the stdio server description.
 *
 * The command is an absolute node binary rather than `'node'` on purpose: an MCP
 * server is started by the editor, not from a shell, so it inherits no `PATH` the
 * user configured, and a machine with node only in a version manager — nvm, fnm,
 * volta, asdf — may need an explicit runtime path. The caller resolves Node
 * or supplies the editor runtime with ELECTRON_RUN_AS_NODE.
 */
export function stdioSpec(options: SpecOptions): StdioServerSpec {
  const spec: StdioServerSpec = {
    label: MCP_SERVER_LABEL,
    command: options.nodePath,
    args: [serverEntryPath(options.extensionPath)],
  };
  // `cwd` is how the server finds the project: an5Orm.config.js, the .an5 files,
  // the installed @an5/orm and DATABASE_URL. Left unset when no folder is open.
  if (options.env) spec.env = { ...options.env };
  if (options.cwd) spec.cwd = options.cwd;
  if (options.version) spec.version = options.version;
  return spec;
}

/** The `mcp.json` entry for a spec. `cwd` is omitted rather than emitted empty. */
export function mcpJsonEntry(spec: StdioServerSpec): McpJsonEntry {
  const entry: McpJsonEntry = { type: 'stdio', command: spec.command, args: spec.args };
  if (spec.env) entry.env = { ...spec.env };
  if (spec.cwd) entry.cwd = spec.cwd;
  return entry;
}

export type McpJsonRoot = '.mcp.json' | '.vscode/mcp.json';

/**
 * The property a config file keeps its servers under.
 *
 * `.mcp.json` is the portable format shared with other agent tools and uses
 * `mcpServers`. `.vscode/mcp.json` is the VS Code-native format and uses
 * `servers`; it is still read, and still worth writing for projects that are
 * already committed to it, but new entries are better off in the portable file.
 */
export function serversKey(root: McpJsonRoot): 'mcpServers' | 'servers' {
  return root === '.mcp.json' ? 'mcpServers' : 'servers';
}

export interface MergeResult {
  /** The file contents to write. */
  text: string;
  /** False when an entry for the key already says the same thing. */
  changed: boolean;
  /** True when there was nothing to merge into and a new object was built. */
  created: boolean;
}

export class McpJsonError extends Error {}

/**
 * Merges one server into an `mcp.json` document, leaving every other server and
 * every other setting alone.
 *
 * Rewriting this file by hand is the step that made installing painful, so the
 * merge has to be safe to run on a file a user has been maintaining by hand:
 *
 *   - a file that is not valid JSON is reported, never overwritten, because the
 *     only way to "fix" it here would be to destroy whatever the user was
 *     editing — including comments, which JSON.parse cannot see
 *   - an identical entry is left untouched, so re-running changes nothing
 *   - `servers`/`mcpServers` that is not an object is reported rather than
 *     silently replaced, for the same reason
 */
export function mergeServerEntry(text: string, key: string, entry: McpJsonEntry, root: McpJsonRoot): MergeResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return {
      text: `${JSON.stringify({ [serversKey(root)]: { [key]: entry } }, null, 2)}\n`,
      changed: true,
      created: true,
    };
  }

  let document: unknown;
  try {
    document = JSON.parse(trimmed);
  } catch (error) {
    throw new McpJsonError(
      `The file is not valid JSON (${(error as Error).message}). Fix or delete it, then run this again.`,
    );
  }

  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    throw new McpJsonError('The file does not contain a JSON object at the top level.');
  }

  const record = document as Record<string, unknown>;
  const containerKey = serversKey(root);
  const existing = record[containerKey];
  if (existing !== undefined && (existing === null || typeof existing !== 'object' || Array.isArray(existing))) {
    throw new McpJsonError(`The "${containerKey}" property is not an object, so no server could be added to it.`);
  }

  const servers = { ...((existing as Record<string, unknown>) ?? {}) };
  if (JSON.stringify(servers[key]) === JSON.stringify(entry)) {
    // Already correct. Keep the original bytes so the file is left untouched.
    return { text, changed: false, created: false };
  }

  servers[key] = entry;
  record[containerKey] = servers;
  return { text: `${JSON.stringify(record, null, 2)}\n`, changed: true, created: false };
}