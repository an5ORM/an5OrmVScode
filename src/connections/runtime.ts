import * as path from 'path';
import { execFile } from 'child_process';
import { nodeRuntime, NodeRuntime } from '../node-runtime';
import { providerOf } from './store';

export function normalizeConnectionString(root: string, value: string): string {
  if (providerOf(value) !== 'sqlite') return value;
  const file = value.replace(/^sqlite:\/\/\//i, '/').replace(/^sqlite:\/\//i, '').replace(/^sqlite:/i, '');
  if (file === ':memory:') return ':memory:';
  return `sqlite:${path.resolve(root, file)}`;
}
export async function testConnection(root: string, connectionString: string, runtime: NodeRuntime = nodeRuntime()): Promise<{ latencyMs: number; provider: string }> {
  const value = normalizeConnectionString(root, connectionString);
  return new Promise((resolve, reject) => {
    execFile(runtime.command, [path.join(__dirname, 'probe.js')], {
      cwd: root, env: { ...process.env, ...runtime.env, DATABASE_URL: value }, timeout: 15000, maxBuffer: 64 * 1024, windowsHide: true,
    }, (error, stdout) => {
      if (error) { reject(new Error('Connection failed. Check Node/adapter installation, the address, credentials, database and network access.')); return; }
      try {
        const result = JSON.parse(stdout);
        if (typeof result.latencyMs !== 'number' || typeof result.provider !== 'string') throw new Error();
        resolve(result);
      } catch { reject(new Error('The connection probe did not return a valid result.')); }
    });
  });
}
