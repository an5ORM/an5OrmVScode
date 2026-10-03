import { resolveWorkspace } from '../mcp/workspace';
import { ConnectionProfile, providerOf } from './store';

/** A live reference to project configuration, never a persisted credential copy. */
export function projectConnection(root: string): { profile: ConnectionProfile; connectionString: string } | undefined {
  const ws = resolveWorkspace(root);
  if (!ws.connectionString) return undefined;
  let provider: string;
  try { provider = providerOf(ws.connectionString); } catch { provider = 'unknown'; }
  return { profile: { id: 'project', name: `Project connection · ${ws.connectionSource || 'config'}`, provider, project: true, source: ws.connectionSource }, connectionString: ws.connectionString };
}

/** Discover nested AN5 projects without evaluating config or following directory symlinks. */
export function projectRoots(root: string): string[] {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const found = new Set<string>([root]);
  const skipped = new Set(['node_modules', '.git', 'dist', 'target', '_site', '.venv', 'venv', 'bin', 'obj']);
  let visited = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > 4 || ++visited > 5000) return;
    if (['an5Orm.config.js', 'an5Orm.config.cjs'].some(name => fs.existsSync(path.join(dir, name)))) found.add(dir);
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory() && !skipped.has(entry.name)) walk(path.join(dir, entry.name), depth + 1);
    } catch { /* unreadable folders do not prevent project discovery */ }
  };
  walk(root, 0);
  return [...found].sort();
}
