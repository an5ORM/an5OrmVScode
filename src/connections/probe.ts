/** Isolated connection probe: credentials arrive via environment, never CLI arguments. */
import { createRequire } from 'module';
import * as path from 'path';

function loadAdapterModule(cwd: string): any {
  const rootReq = createRequire(path.join(cwd, 'package.json'));

  // 1. Direct workspace dependency
  try {
    return rootReq('@an5/adapters');
  } catch {
    // 2. Transitive dependency via @an5/orm (supports pnpm virtual store, yarn PnP, hoisted dependencies)
    try {
      const ormPkg = rootReq.resolve('@an5/orm');
      return createRequire(ormPkg)('@an5/adapters');
    } catch {
      try {
        const ormPkgJson = rootReq.resolve('@an5/orm/package.json');
        return createRequire(ormPkgJson)('@an5/adapters');
      } catch {
        // 3. Ambient fallback
        try {
          return require('@an5/adapters');
        } catch {
          throw new Error('Install @an5/adapters in this workspace to test a connection.');
        }
      }
    }
  }
}

function sanitizeError(err: unknown): string {
  if (!err) return 'Unknown connection error';
  let message = typeof err === 'object' && err !== null && 'message' in err && typeof (err as any).message === 'string'
    ? (err as any).message
    : String(err);
  return message
    .replace(/(:\/\/[^@/]*:)[^@]*@/g, '$1••••••••@')
    .replace(/((?:password|pwd|privateKey|apiKey|accessToken|refreshToken)=)[^;&\s]*/gi, '$1••••••••');
}

async function main(): Promise<void> {
  let adapter: any;
  try {
    const mod = loadAdapterModule(process.cwd());
    adapter = mod.createAn5Adapter({ connectionString: process.env.DATABASE_URL, connectionTimeout: 10000, requestTimeout: 10000 });
    const started = Date.now();
    await adapter.$connect();
    await adapter.exec('SELECT 1 AS an5_connection_test', {});
    process.stdout.write(JSON.stringify({ latencyMs: Date.now() - started, provider: adapter.dialect }));
  } catch (err) {
    process.stderr.write(sanitizeError(err));
    process.exitCode = 1;
  } finally {
    if (adapter) await adapter.$disconnect().catch(() => undefined);
  }
}
void main();
