import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { nodeRuntime, NodeRuntime } from './node-runtime';
import { Workspace } from './mcp/workspace';

/**
 * A process to launch. `shell` is set only for the Windows last resort where
 * `npm.cmd` must go through `cmd.exe`; every other plan is a direct executable
 * that `execFile`/`ProcessExecution` can start without a shell.
 */
export interface ProjectCommand { command: string; args: string[]; env: Record<string, string>; cwd: string; shell?: boolean }

export interface ProjectCommandHost { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv }

/** Characters that are safe to pass through `cmd.exe` without quoting tricks. */
const SHELL_SAFE = /^[\w:.\-/=@]+$/;

function isFile(candidate: string): boolean {
  try { return fs.statSync(candidate).isFile(); } catch { return false; }
}

/**
 * Finds npm's JavaScript entry point so Windows can run npm through Node rather
 * than through `npm.cmd`, which `execFile` cannot start (spawn EINVAL).
 */
export function findNpmCli(runtime: NodeRuntime, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const execPath = env.npm_execpath;
  if (execPath && /npm-cli\.js$/i.test(execPath) && isFile(execPath)) return execPath;
  const dirs = [path.dirname(runtime.command), ...(env.PATH || env.Path || '').split(path.delimiter)]
    .filter(dir => dir && path.isAbsolute(dir));
  for (const dir of dirs) {
    const candidate = path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (isFile(candidate)) return candidate;
  }
  return undefined;
}

/** Execute project scripts in the project, or use an installed ORM entry point. */
export function projectCommand(
  ws: Workspace,
  script: string,
  args: string[] = [],
  runtime: NodeRuntime = nodeRuntime(),
  host: ProjectCommandHost = {},
): ProjectCommand {
  const platform = host.platform ?? process.platform;
  const hostEnv = host.env ?? process.env;
  let scripts: Record<string, unknown> = {};
  try { scripts = JSON.parse(fs.readFileSync(path.join(ws.root, 'package.json'), 'utf8')).scripts || {}; } catch { /* package.json is optional */ }
  const env = { ...(ws.connectionString ? { DATABASE_URL: ws.connectionString } : {}) };
  const nodePlan = (entry: string, entryArgs: string[]): ProjectCommand =>
    ({ command: runtime.command, args: [entry, ...entryArgs], env: { ...runtime.env, ...env }, cwd: ws.root });

  if (typeof scripts[script] === 'string') {
    const npmArgs = ['run', script, ...(args.length ? ['--', ...args] : [])];
    if (platform !== 'win32') return { command: 'npm', args: npmArgs, env, cwd: ws.root };
    const npmCli = findNpmCli(runtime, hostEnv);
    if (npmCli) return nodePlan(npmCli, npmArgs);
    const unsafe = npmArgs.find(arg => !SHELL_SAFE.test(arg));
    if (unsafe !== undefined) throw new Error(`Cannot pass "${unsafe}" to npm.cmd safely. Set an5.nodePath to a Node installation that includes npm.`);
    return { command: 'npm.cmd', args: npmArgs, env, cwd: ws.root, shell: true };
  }

  if (!ws.ormDir) throw new Error(`Install @an5/orm or add a "${script}" npm script in this workspace.`);
  if (script === 'generate') {
    const entry = path.join(ws.ormDir, 'dist', 'generator', 'src', 'index.js');
    if (fs.existsSync(entry)) return nodePlan(entry, args);
  }
  const action = script.startsWith('db:migrate:') ? script.slice('db:migrate:'.length) : undefined;
  const entryName = action ? 'migrate' : ({ 'db:push': 'push', 'db:pull': 'pull', 'db:seed': 'seed' } as Record<string, string>)[script];
  if (entryName) {
    // Published @an5/orm ships compiled JavaScript; its CLI understands db:* commands.
    const cli = path.join(ws.ormDir, 'dist', 'cli.js');
    if (isFile(cli)) return nodePlan(cli, [script, ...args]);
    const compiled = path.join(ws.ormDir, 'dist', `${entryName}.js`);
    if (isFile(compiled)) return nodePlan(compiled, [...(action ? [action] : []), ...args]);
    // Source checkouts of the ORM keep TypeScript entry points.
    const entry = path.join(ws.ormDir, `${entryName}.ts`);
    if (fs.existsSync(entry)) {
      let tsx: string | undefined;
      for (const root of [ws.root, ws.ormDir]) {
        try { tsx = createRequire(path.join(root, 'package.json')).resolve('tsx/cli'); break; } catch { /* try ORM checkout */ }
      }
      if (tsx) return nodePlan(tsx, [entry, ...(action ? [action] : []), ...args]);
    }
  }
  throw new Error(`This ORM installation does not provide a runnable "${script}" entry point. Add the command as a workspace npm script; no files or database changes were made.`);
}
