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
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = (stderr || '').trim();
        const safeDetail = detail
          ? detail.replace(/(:\/\/[^@/]*:)[^@]*@/g, '$1••••••••@').replace(/((?:password|pwd|privateKey|apiKey|token|accessToken|refreshToken)=)[^;&\s]*/gi, '$1••••••••')
          : '';
        const msg = safeDetail
          ? `Connection failed: ${safeDetail}`
          : 'Connection failed. Check Node/adapter installation, the address, credentials, database and network access.';
        reject(new Error(msg));
        return;
      }
      try {
        const result = JSON.parse(stdout);
        if (typeof result.latencyMs !== 'number' || typeof result.provider !== 'string') throw new Error();
        resolve(result);
      } catch { reject(new Error('The connection probe did not return a valid result.')); }
    });
  });
}

export async function runExplorer(
  root: string,
  connectionString: string,
  request: { action: 'tables' | 'rows' | 'seed' | 'vector'; table?: string; row?: Record<string, unknown>; vector?: number[]; topK?: number },
  runtime: NodeRuntime = nodeRuntime(),
): Promise<Record<string, unknown>> {
  const value = normalizeConnectionString(root, connectionString);
  return new Promise((resolve, reject) => {
    execFile(runtime.command, [path.join(__dirname, 'probe.js')], {
      cwd: root,
      env: { ...process.env, ...runtime.env, DATABASE_URL: value, AN5_EXPLORER_REQ: JSON.stringify(request) },
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = (stderr || '').trim();
        reject(new Error(detail || 'Explorer query failed.'));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error('Explorer did not return valid JSON.'));
      }
    });
  });
}
