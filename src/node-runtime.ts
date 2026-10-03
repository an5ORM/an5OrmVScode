import * as fs from 'fs';
import * as path from 'path';
export interface NodeRuntime { command: string; env: Record<string, string> }
/** Prefer the project's Node environment so installed native adapters use the matching ABI. */
export function nodeRuntime(configured?: string, execPath = process.execPath, env = process.env): NodeRuntime {
  const executable = (candidate: string) => {
    try { fs.accessSync(candidate, fs.constants.X_OK); return fs.statSync(candidate).isFile(); } catch { return false; }
  };
  if (configured) {
    if (!path.isAbsolute(configured) || !executable(configured)) throw new Error('an5.nodePath must point to an executable Node binary using an absolute path.');
    return { command: configured, env: {} };
  }
  if (/^node(?:\.exe)?$/i.test(path.basename(execPath))) return { command: execPath, env: {} };
  for (const dir of (env.PATH || '').split(path.delimiter).filter(Boolean)) {
    if (!path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, process.platform === 'win32' ? 'node.exe' : 'node');
    if (executable(candidate)) return { command: candidate, env: {} };
  }
  return { command: execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
}
