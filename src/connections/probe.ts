/** Isolated connection probe: credentials arrive via environment, never CLI arguments. */
import { createRequire } from 'module';
import * as path from 'path';

async function main(): Promise<void> {
  let adapter: any;
  try {
    let mod: any;
    try { mod = createRequire(path.join(process.cwd(), 'package.json'))('@an5/adapters'); }
    catch { throw new Error('Install @an5/adapters in this workspace to test a connection.'); }
    adapter = mod.createAn5Adapter({ connectionString: process.env.DATABASE_URL, connectionTimeout: 10000, requestTimeout: 10000 });
    const started = Date.now();
    await adapter.$connect();
    await adapter.exec('SELECT 1 AS an5_connection_test', {});
    process.stdout.write(JSON.stringify({ latencyMs: Date.now() - started, provider: adapter.dialect }));
  } catch {
    process.exitCode = 1;
  } finally { if (adapter) await adapter.$disconnect().catch(() => undefined); }
}
void main();
