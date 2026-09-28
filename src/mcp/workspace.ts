/**
 * Project discovery for the AN5 MCP server.
 *
 * The server runs as a child process spawned by VS Code with the workspace
 * folder as its working directory, so everything it needs is discovered from
 * there: the ORM config, the schema directory, the installed `@an5/orm` /
 * `@an5/adapters` packages and `DATABASE_URL`.
 */
import * as fs from 'fs';
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
}

const CONFIG_CANDIDATES = ['an5Orm.config.js', 'an5Orm.config.cjs'];

/** Reads `an5Orm.config.*` by evaluating it, since it is a CommonJS module. */
function readConfig(root: string): { configPath?: string; config: An5Config } {
  for (const name of CONFIG_CANDIDATES) {
    const candidate = path.join(root, name);
    if (!fs.existsSync(candidate)) continue;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const loaded = require(candidate) as An5Config | { default?: An5Config };
      const config =
        loaded && typeof loaded === 'object' && 'default' in loaded && loaded.default
          ? loaded.default
          : (loaded as An5Config);
      return { configPath: candidate, config: (config ?? {}) as An5Config };
    } catch {
      return { configPath: candidate, config: {} };
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
  const candidates = [
    path.join(root, 'node_modules', '@an5', 'orm'),
    path.join(root, '..', 'an5Orm'),
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'package.json')));
}

/** Reads `DATABASE_URL` from `.env` without pulling in a dotenv dependency. */
function readConnectionString(root: string): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  for (const name of ['.env', path.join(root, '.env')]) {
    const file = path.isAbsolute(name) ? name : path.join(root, name);
    if (!fs.existsSync(file)) continue;
    try {
      const match = fs
        .readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.startsWith('DATABASE_URL='));
      if (match) {
        const value = match.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
        if (value) return value;
      }
    } catch {
      // Ignore unreadable .env and fall through to "not configured".
    }
  }
  return undefined;
}

export function resolveWorkspace(root: string = process.cwd()): Workspace {
  const { configPath, config } = readConfig(root);
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
    connectionString: readConnectionString(root),
  };
}
