/**
 * Project discovery for the AN5 MCP server.
 *
 * The server runs as a child process spawned by VS Code with the workspace
 * folder as its working directory, so everything it needs is discovered from
 * there: the ORM config, the schema directory, the installed `@an5/orm` /
 * `@an5/adapters` packages and `DATABASE_URL`.
 */
import * as fs from 'fs';
import { createRequire } from 'module';
import * as path from 'path';

export interface An5Config {
  schemaDir?: string;
  outputs?: Record<string, { outputDir?: string; metadataFile?: string }>;
  [key: string]: unknown;
}

export interface Workspace {
  /** Folder the server was started in. */
  root: string;
  /** Absolute path of `an5Orm.config.js`/`.cjs`, when present. */
  configPath?: string;
  config: An5Config;
  /** Absolute path of the directory holding `.an5` files. */
  schemaDir: string;
  /** Absolute `.an5` files found in the project. */
  schemaFiles: string[];
  /** Installed `@an5/orm` package directory, when resolvable. */
  ormDir?: string;
  /** `DATABASE_URL` from the process env or the project's `.env`. */
  connectionString?: string;
  connectionSource?: string;
}

const CONFIG_CANDIDATES = ['an5Orm.config.js', 'an5Orm.config.cjs'];

/** Reads `an5Orm.config.*` by evaluating it, since it is a CommonJS module. */
function readConfig(root: string): { configPath?: string; config: An5Config } {
  for (const name of CONFIG_CANDIDATES) {
    const candidate = path.join(root, name);
    if (!fs.existsSync(candidate)) continue;
    const previousEnv = { ...process.env };
    try {
      // Resolve config references against this project's .env without contaminating other projects.
      for (const [key, value] of Object.entries(readEnv(root))) if (process.env[key] === undefined) process.env[key] = value;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      delete require.cache[require.resolve(candidate)];
      const loaded = require(candidate) as An5Config | { default?: An5Config };
      const config =
        loaded && typeof loaded === 'object' && 'default' in loaded && loaded.default
          ? loaded.default
          : (loaded as An5Config);
      return { configPath: candidate, config: (config ?? {}) as An5Config };
    } catch {
      return { configPath: candidate, config: {} };
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
      Object.assign(process.env, previousEnv);
    }
  }
  return { config: {} };
}

/** Collects `.an5` files, skipping dependencies and build output. */
function findSchemaFiles(dir: string, depth = 0): string[] {
  if (depth > 4) return [];
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'target') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.an5')) {
      out.push(full);
    } else if (entry.isDirectory()) {
      out.push(...findSchemaFiles(full, depth + 1));
    }
  }
  return out.sort();
}

/** Loads the installed `@an5/orm`, checking the project and its parent. */
function findOrmDir(root: string): string | undefined {
  try { return path.dirname(createRequire(path.join(root, 'package.json')).resolve('@an5/orm/package.json')); } catch { /* local checkout fallback */ }
  const candidates = [
    path.join(root, 'node_modules', '@an5', 'orm'),
    path.join(root, '..', 'an5Orm'),
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'package.json')));
}

/** Parse the project's environment file without mutating the extension host. */
function readEnv(root: string): Record<string, string> {
  const values: Record<string, string> = {};
  try {
    for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      const raw = match[2].trim();
      const quote = raw[0];
      values[match[1]] = quote === '"' || quote === "'" ? raw.slice(1, raw.indexOf(quote, 1) < 0 ? undefined : raw.indexOf(quote, 1)) : raw.replace(/\s+#.*$/, '').trim();
    }
  } catch { /* Missing/unreadable .env is optional. */ }
  return values;
}

export function resolveWorkspace(root: string = process.cwd()): Workspace {
  const { configPath, config } = readConfig(root);
  const envValue = process.env.DATABASE_URL?.trim();
  const fileValue = readEnv(root).DATABASE_URL;
  const configValue = typeof config.connectionString === 'string' ? config.connectionString.trim() : undefined;
  const connectionString = envValue || fileValue || configValue;
  const connectionSource = envValue ? 'DATABASE_URL' : fileValue ? '.env' : configValue ? path.basename(configPath || 'an5Orm.config.js') : undefined;
  const schemaDirName = typeof config.schemaDir === 'string' ? config.schemaDir : 'an5Schema';
  const configuredSchemaDir = path.resolve(root, schemaDirName);
  const schemaFiles = findSchemaFiles(configuredSchemaDir);

  // A missing or empty configured directory is common enough (config not yet
  // written, schema elsewhere) that falling back to a project-wide scan keeps
  // the tools useful instead of failing outright.
  const fallbackFiles = schemaFiles.length > 0 ? schemaFiles : findSchemaFiles(root);

  return {
    root,
    configPath,
    config,
    schemaDir: fallbackFiles.length > 0 ? path.dirname(fallbackFiles[0] as string) : configuredSchemaDir,
    schemaFiles: fallbackFiles,
    ormDir: findOrmDir(root),
    connectionString,
    connectionSource,
  };
}
