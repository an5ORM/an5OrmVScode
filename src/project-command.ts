import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { nodeRuntime, NodeRuntime } from './node-runtime';
import { Workspace } from './mcp/workspace';

export interface ProjectCommand { command: string; args: string[]; env: Record<string, string>; cwd: string }
/** Execute project scripts in the project, or use an installed ORM entry point. */
export function projectCommand(ws: Workspace, script: string, args: string[] = [], runtime: NodeRuntime = nodeRuntime()): ProjectCommand {
  let scripts: Record<string, unknown> = {};
  try { scripts = JSON.parse(fs.readFileSync(path.join(ws.root, 'package.json'), 'utf8')).scripts || {}; } catch { /* package.json is optional */ }
  const env = { ...(ws.connectionString ? { DATABASE_URL: ws.connectionString } : {}) };
  if (typeof scripts[script] === 'string') {
    return { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', script, ...(args.length ? ['--', ...args] : [])], env, cwd: ws.root };
  }
  if (!ws.ormDir) throw new Error(`Install @an5/orm or add a "${script}" npm script in this workspace.`);
  if (script === 'generate') {
    const entry = path.join(ws.ormDir, 'dist', 'generator', 'src', 'index.js');
    if (fs.existsSync(entry)) return { command: runtime.command, args: [entry, ...args], env: { ...runtime.env, ...env }, cwd: ws.root };
  }
  const action = script.startsWith('db:migrate:') ? script.slice('db:migrate:'.length) : undefined;
  const entryName = action ? 'migrate' : { 'db:push': 'push', 'db:pull': 'pull', 'db:seed': 'seed' }[script];
  if (entryName) {
    const entry = path.join(ws.ormDir, `${entryName}.ts`);
    if (fs.existsSync(entry)) {
      let tsx: string | undefined;
      for (const root of [ws.root, ws.ormDir]) {
        try { tsx = createRequire(path.join(root, 'package.json')).resolve('tsx/cli'); break; } catch { /* try ORM checkout */ }
      }
      if (tsx) return { command: runtime.command, args: [tsx, entry, ...(action ? [action] : []), ...args], env: { ...runtime.env, ...env }, cwd: ws.root };
    }
  }
  throw new Error(`This ORM installation does not provide a runnable "${script}" entry point. Add the command as a workspace npm script; no files or database changes were made.`);
}
